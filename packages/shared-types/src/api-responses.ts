export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiError;
