export type Meta = Record<string, unknown>;

export interface ParsedFieldInput {
  name: string;
  value: string;
  meta: Meta;
}

export interface CustomField {
  name: string;
  label: string;
}

export type FieldInput =
  | string
  | {
      value?: string;
      meta?: Meta;
    };
