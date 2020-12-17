import { RequestPerformer } from './types';
declare class FetchRequestPerformer implements RequestPerformer<Request, Response> {
    readonly performRequest: typeof fetch;
}
export default FetchRequestPerformer;
