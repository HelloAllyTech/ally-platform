import {Translation} from '../i18n';

// returns S1.S2
// eg: let S1 = "x", let S2 = "y", returns "x.y"

// eg: let S1 = "x", let S2 = "y" | "z", returns "x.y" | "x.z"
export type Join<S1, S2> = S1 extends string
  ? S2 extends string
    ? `${S1}.${S2}`
    : never
  : never;

// for each key in the type,
//    if the value of keys is not object then return the key itself
//    if the value of key is object then Join with the first param as the current key and second param as the path of value of the current key
export type Paths<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown>
    ? Join<K, Paths<T[K]>>
    : K;
}[keyof T];

export type TranslationType = Paths<Translation>;
