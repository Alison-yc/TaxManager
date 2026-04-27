export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** 对应 public.form_data */
export type FormDataRow = {
  id: string
  user_id: string | number | null
  created_at: string
  content: Json | null
}
