export interface LogSerializer<T> {
  name: string;
  allowlist: (keyof T & string)[];
}
