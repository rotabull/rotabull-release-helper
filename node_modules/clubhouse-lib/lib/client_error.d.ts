export default class ClientError extends Error {
    readonly response: Response;
    readonly body: any;
    constructor(response: Response, body: Record<string, any>);
}
