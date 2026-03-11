export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiError;
