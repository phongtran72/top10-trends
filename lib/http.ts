// HTTP client used by collectors. Task 1.2 adds the implementation.

export interface RequestOptions {
  headers?: Record<string, string>;
}

export interface Http {
  getJson(url: string, options?: RequestOptions): Promise<unknown>;
  getXml(url: string, options?: RequestOptions): Promise<unknown>;
  postFormJson(url: string, form: Record<string, string>, options?: RequestOptions): Promise<unknown>;
}
