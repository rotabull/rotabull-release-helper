import { RequestFactory } from './types';
declare class TokenRequestFactory implements RequestFactory<Request> {
    readonly token: string;
    readonly baseURL: string;
    readonly version: string;
    constructor(token: string, baseURL: string, version: string);
    prefixURI(uri: string): string;
    createRequest(uri: string, method?: string, body?: Record<string, any>): Request;
}
export default TokenRequestFactory;
