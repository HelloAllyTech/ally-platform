export type Maybe<T> = T | null;

export const isEmptyObject = (obj?: object | null) => {
  return obj ? Object.keys(obj).length === 0 : true;
};
