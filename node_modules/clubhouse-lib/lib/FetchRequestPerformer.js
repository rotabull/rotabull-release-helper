"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('fetch-everywhere');
var FetchRequestPerformer = /** @class */ (function () {
    function FetchRequestPerformer() {
        this.performRequest = fetch;
    }
    return FetchRequestPerformer;
}());
exports.default = FetchRequestPerformer;
