import { ResponseParser } from './types';
declare class FetchRequestParser implements ResponseParser<Response> {
    readonly parseResponse: (response: Response) => Promise<Record<string, any>>;
}
export default FetchRequestParser;
