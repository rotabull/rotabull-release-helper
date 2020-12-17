"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var universal_url_1 = require("universal-url");
require('fetch-everywhere');
var TokenRequestFactory = /** @class */ (function () {
    function TokenRequestFactory(token, baseURL, version) {
        this.token = token;
        this.baseURL = baseURL;
        this.version = version;
    }
    TokenRequestFactory.prototype.prefixURI = function (uri) {
        var prefix = "/api/" + this.version + "/";
        if (uri.startsWith(prefix)) {
            return uri;
        }
        return "" + prefix + uri;
    };
    TokenRequestFactory.prototype.createRequest = function (uri, method, body) {
        if (method === void 0) { method = 'GET'; }
        var url = new universal_url_1.URL(this.prefixURI(uri), this.baseURL);
        var headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json; charset=utf-8',
        };
        url.searchParams.append('token', this.token);
        if (method === 'GET') {
            if (body) {
                Object.entries(body).forEach(function (entry) {
                    return url.searchParams.append(entry[0], String(entry[1]));
                });
            }
            return new Request(url.toString(), {
                headers: headers,
                method: method,
            });
        }
        return new Request(url.toString(), {
            body: JSON.stringify(body),
            headers: headers,
            method: method,
        });
    };
    return TokenRequestFactory;
}());
exports.default = TokenRequestFactory;
