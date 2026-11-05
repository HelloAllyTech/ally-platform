import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  mainContainer: {
    position: 'relative',
    alignSelf: 'stretch',
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '4@ms',
    paddingHorizontal: '12@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    flex: 1,
  },
  placeholder: {
    color: colors.charcoal2,
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
  arrow: {
    marginLeft: '8@ms',
  },
  arrowUp: {
    transform: [{rotate: '180deg'}],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalDropdown: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: '10@ms',
    borderWidth: 1,
    borderColor: colors.lightGray7,
    elevation: 5,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '8@ms',
    paddingHorizontal: '12@ms',
    borderWidth: 1,
    borderColor: colors.lightGray7,
    borderRadius: '6@ms',
    backgroundColor: colors.lightGray,
    margin: '12@ms',
    marginBottom: '12@ms',
  },
  searchIconStyle: {
    marginRight: '8@ms',
  },
  searchInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  item: {
    paddingVertical: '12@ms',
    paddingHorizontal: '16@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
  },
  lastOption: {
    borderBottomWidth: 0,
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  loadingContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  noResultsContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  noResultsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  instructionContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  instructionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
});
