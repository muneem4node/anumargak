var { getFirstMatche, getAllMatches, doesMatch, urlSlice } = require("./util");
var namedExpressionsStore = require("./namedExpressionsStore");
var semverStore = require("semver-store");

var httpMethods = ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS", "PATCH", "TRACE", "CONNECT", "COPY", "LINK", "UNLINK", "PURGE", "LOCK", "UNLOCK", "PROPFIND", "VIEW"];


Anumargak.prototype.addNamedExpression = function (arg1, arg2) {
    this.namedExpressions.addNamedExpression(arg1, arg2);
}

/**
 * Adds routes against the given method and URL
 * @param {string | array} method 
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.on = function (method, url, options, fn) {

    if (typeof options === 'function') {
        fn = options;
        options = {};
    }

    if (typeof method === "string") {
        this.normalizeUrl(method, url, options, fn);
    } else if (Array.isArray(method)) {
        for (var i = 0; i < method.length; i++) {
            this.normalizeUrl(method[i], url, options, fn);
        }
    } else {
        throw Error("Invalid method argument. String or array is expected.");
    }
}

var wildcardRegexStr = "\\/([^\\/:]*)\\*";
var paramRegexStr = ":([^\\/\\-\\(]+)-?(\\(.*?\\))?";
var enumRegexStr = ":([^\\/\\-\\(]+)-?(\\(([\\w\\|]+)\\))";


Anumargak.prototype.normalizeUrl = function (method, url, options, fn) {
    
    //validate for correct input
    if (httpMethods.indexOf(method) === -1) throw Error("Invalid method type " + method);
    this.count += 1;

    //Normalize URL
    if (this.ignoreLeadingSlash) {
        if (url.startsWith("/") === false) {
            url = "/" + url;
        }
    }

    url = this.namedExpressions.replaceNamedExpression(url);

    var matches = getFirstMatche(url, wildcardRegexStr);
    if (matches) {
        url = url.substr(0, matches.index + 1) + ":*(" + matches[0].substr(1, matches[0].length - 2) + ".*)"
    }

    this._addRoute(method, url, options, fn);
}

/*
paramas is useful in case of enum url where we know the parameter value in advance.
*/
Anumargak.prototype._addRoute = function (method, url, options, fn, params) {

    var found = this._checkForEnum(method, url, options, fn, params);
    if(found) return;

    var matches = getAllMatches(url, paramRegexStr);
    if (matches.length > 0) {//DYNAMIC
        this._addDynamic(method, url, options, fn, params, matches);
    } else {//STATIC
        this._addStatic(method, url, options, fn, params, this.ignoreTrailingSlash);
    }
}

/**
 * Check and register if given URL need enumerated params.
 * @param {string} method 
 * @param {string} url 
 * @param {object | function} options 
 * @param {function} fn 
 * @param {object} params 
 */
Anumargak.prototype._checkForEnum = function(method, url, options, fn, params){
    var matches = getFirstMatche(url, enumRegexStr);
    if (matches) {
        var name = matches[1];
        var pattern = matches[3];

        var arr = pattern.split("\|");
        for (var i = 0; i < arr.length; i++) {
            var newurl = url.replace(matches[0], arr[i]);
            if (params) {
                params = Object.assign({}, params);
                params[name] = arr[i];
            } else {
                params = {};
                params[name] = arr[i];
            }
            this._addRoute(method, newurl, options, fn, params);
        }
        return true;
    }
}

Anumargak.prototype._addStatic = function(method, url, options, fn, params, ignoreTrailingSlash){
    this.checkIfRegistered(this.staticRoutes, method, url, options, fn);

    var routeData = this.getRouteData(this.staticRoutes[method][url], method, url, options, fn);
    this.staticRoutes[method][url] = { 
        fn : routeData.handler,
        verMap: routeData.verMap, 
        params: params 
    };

    //this.staticRoutes[method][url] = { fn: fn, params: params };
    if (ignoreTrailingSlash) {
        if (url.endsWith("/")) {
            url = url.substr(0, url.length - 1);
        } else {
            url = url + "/";
        }
        
        var routeData = this.getRouteData(this.staticRoutes[method][url], method, url, options, fn);
        this.staticRoutes[method][url] = { 
            fn : routeData.handler,
            verMap: routeData.verMap, 
            params: params 
        };

    }

}

Anumargak.prototype._addDynamic = function(method, url, options, fn, params, matches){
    var paramsArr = [];
    for (var i = 0; i < matches.length; i++) {
        var name = matches[i][1];
        var pattern = matches[i][2];

        paramsArr.push(name);
        if (pattern) {
            if (name === "*" && pattern !== "(.*)") {
                var breakIndex = pattern.indexOf(".*");
                url = url.replace(matches[i][0], pattern.substr(1, breakIndex - 1) + "(.*)");
            } else {
                url = url.replace(matches[i][0], pattern);
            }
        } else {
            url = url.replace(matches[i][0], "([^\\/]+)");
        }
        
    }

    if (this.ignoreTrailingSlash) {
        if (url.endsWith("/")) {
            url = url + "?";
        } else {
            url = url + "/?";
        }
    }
    var regex = new RegExp("^" + url + "$");
    this.checkIfRegistered(this.dynamicRoutes, method, url, options, fn);

    var routeData = this.getRouteData(this.dynamicRoutes[method][url], method, url, options, fn);
    
    this.dynamicRoutes[method][url] = { 
        fn: routeData.handler,
        regex: regex, 
        verMap: routeData.verMap, 
        params: params || {}, 
        paramsArr: paramsArr 
    };    
}



Anumargak.prototype.getRouteData = function (route, method, url, options, fn) {
    if(options.version){
        var verMap, handler;
        if( route ){
            if( route.verMap ){
                verMap = route.verMap;
            }else{
                verMap = new semverStore();
            }
            if (route.fn){
                handler = route.fn;
            }
        }else{
            verMap = new semverStore();
        }
        verMap.set( options.version, fn );

        return { 
            handler: handler,
            verMap: verMap, 
        };    
    }else{
        return { 
            handler: fn
        };
    }
}

Anumargak.prototype.checkIfRegistered = function (arr, method, url, options, fn) {
    var result = this.isRegistered(arr, method, url);
    if (result) {
        if(options.version){//check if the version is same
            var route;
            if( this.dynamicRoutes[method][result] ){
                route = this.dynamicRoutes[method][result];
            }else {
                route = this.staticRoutes[method][result];
            }

            if(route.verMap && route.verMap.get( options.version )){
                throw Error(`Given route is matching with already registered route`);
            }
        }else{
            throw Error(`Given route is matching with already registered route`);
        }
    }
}

var urlPartsRegex = new RegExp("(\\/\\(.*?\\)|\\/[^\\(\\)\\/]+)");

Anumargak.prototype.isRegistered = function (arr, method, url) {
    if (arr[method][url]) {//exact route is already registered
        return url;
    } else {
        //check if tricky similar route is already registered
        //"/this/path/:is/dynamic"
        //"/this/:path/is/dynamic"
        var urls = Object.keys( arr[method] );
        var givenUrlParts = getAllMatches(url, urlPartsRegex);
        for (var u_i in urls) {//compare against all the registered URLs
            var urlParts = getAllMatches(urls[u_i], urlPartsRegex);
            if (urlParts.length !== givenUrlParts.length) {
                continue;
            } else {
                var matchUrl = true;
                for (var urlPart_i in urlParts) {
                    if (doesMatch(urlParts[urlPart_i][1], givenUrlParts[urlPart_i][1])) {
                        continue
                    } else {
                        matchUrl = false;
                        break;
                    }
                }
                if (matchUrl) {
                    return urls[u_i];
                }
            }
        }

        return false;
    }
}


Anumargak.prototype.find = function (method, url, version) {
    url = urlSlice(url);
    var result = this.staticRoutes[method][url];
    if (result) return this.getHandler(result, version);
    else {
        var urlRegex = Object.keys(this.dynamicRoutes[method]);
        for (var i = 0; i < urlRegex.length; i++) {
            if (this.dynamicRoutes[method][urlRegex[i]].regex.exec(url))
                return this.getHandler( this.dynamicRoutes[method][ urlRegex[i] ], version);
        }
    }
    return this.defaultFn;
}


Anumargak.prototype.getHandler = function (route, version) {
    if(version){
        return route.verMap.get(version);
    }else{
        return route.fn;
    }
}

Anumargak.prototype.lookup = function (req, res) {
    var method = req.method;
    var url = urlSlice(req.url);
    var version = req.headers['accept-version'];

    var result = this._lookup(url, method, version);
    result.fn(req, res, result.params);
}

Anumargak.prototype._lookup = function (url, method, version) {
    var result = this.staticRoutes[method][url];
    if (result) return { fn: this.getHandler(result, version), params: result.params };
    else {
        var urlRegex = Object.keys(this.dynamicRoutes[method]);
        for (var i = 0; i < urlRegex.length; i++) {
            var route = this.dynamicRoutes[method][urlRegex[i]];
            var matches = route.regex.exec(url);
            var params = route.params;
            if (matches) {
                for (var m_i = 1; m_i < matches.length; m_i++) {
                    params[route.paramsArr[m_i - 1]] = matches[m_i];
                }
                return { fn: this.getHandler(this.dynamicRoutes[method][urlRegex[i]], version), params: params };
            }
        }
    }
    return { fn: this.defaultFn };
}

/**
 * Adds routes for GET method and URL
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.get = function (url, options, fn) {
    this.on("GET", url, options, fn);
}
/**
 * Adds routes for HEAD method and URL
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.head = function (url, options, fn) {
    this.on("HEAD", url, options, fn);
}
/**
 * Adds routes for PUT method and URL
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.put = function (url, options, fn) {
    this.on("PUT", url, options, fn);
}
/**
 * Adds routes for POST method and URL
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.post = function (url, options, fn) {
    this.on("POST", url, options, fn);
}
/**
 * Adds routes for DELETE method and URL
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.delete = function (url, options, fn) {
    this.on("DELETE", url, options, fn);
}

function Anumargak(options) {
    if (!(this instanceof Anumargak)) return new Anumargak(options);
    this.count = 0;
    this.namedExpressions = namedExpressionsStore();
    this.dynamicRoutes = {
        GET: {},
        HEAD: {},
        PUT: {},
        POST: {},
        DELETE: {},
        OPTIONS: {},
        PATCH: {},
        TRACE: {},
        CONNECT: {},
        COPY: {},
        LINK: {},
        UNLINK: {},
        PURGE: {},
        LOCK: {},
        UNLOCK: {},
        PROPFIND: {},
        VIEW: {}
    }

    this.staticRoutes = {
        GET: {},
        HEAD: {},
        PUT: {},
        POST: {},
        DELETE: {},
        OPTIONS: {},
        PATCH: {},
        TRACE: {},
        CONNECT: {},
        COPY: {},
        LINK: {},
        UNLINK: {},
        PURGE: {},
        LOCK: {},
        UNLOCK: {},
        PROPFIND: {},
        VIEW: {}
    }

    if (options) {
        if (options.defaultRoute) {
            this.defaultFn = options.defaultRoute;
        }
        this.ignoreTrailingSlash = options.ignoreTrailingSlash || false;
        this.ignoreLeadingSlash = options.ignoreLeadingSlash || true;
        this.overwriteAllow = options.overwriteAllow || false;
    }
}

module.exports = Anumargak;