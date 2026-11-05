import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    padding: '16@ms',
  },
  title: {
    fontSize: '32@ms',
    marginBottom: '8@ms',
    fontWeight: '500',
  },
  subtitle: {
    fontSize: '18@ms',
    marginBottom: '32@ms',
  },
  inputContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inputWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrapperError: {
    borderWidth: '1@ms',
    borderRadius: '12@ms',
    borderColor: colors.vividRed,
  },
  inputDash: {
    position: 'absolute',
    bottom: '20@ms',
    height: '1@s',
    width: '10@s',
    fontSize: '24@ms',
    zIndex: 1,
    backgroundColor: 'gray',
  },
  input: {
    width: '60@ms',
    height: '60@ms',
    borderWidth: '1@ms',
    borderColor: colors.lightGray2,
    borderRadius: '12@ms',
    backgroundColor: '#F5F5F5',
    textAlign: 'center',
    fontSize: '24@ms',
    fontWeight: '600',
  },
  inputEmpty: {
    color: 'transparent',
  },
  inputFilled: {
    color: colors.black,
  },
});
