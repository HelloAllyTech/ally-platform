import {useTranslation} from 'react-i18next';

import {TranslationType} from '@/localization/locales/type';

const useTranslate = () => {
  const {t} = useTranslation();
  const translate = (
    key: TranslationType,
    interpolationKeys: {[key: string]: unknown} = {},
  ): string => {
    return t(key, interpolationKeys) as string;
  };

  return {
    t: translate,
    // tVariable is to translate variable params
    tVariable: t,
  };
};

export default useTranslate;
