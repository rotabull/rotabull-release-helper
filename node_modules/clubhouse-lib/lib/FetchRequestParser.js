"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var client_error_1 = require("./client_error");
var FetchRequestParser = /** @class */ (function () {
    function FetchRequestParser() {
        this.parseResponse = function (response) {
            return response
                .json()
                .then(function (json) {
                if (response.ok) {
                    return json;
                }
                return Promise.reject(new client_error_1.default(response, json));
            })
                .catch(function () { return Promise.reject(new client_error_1.default(response, {})); });
        };
    }
    return FetchRequestParser;
}());
exports.default = FetchRequestParser;
