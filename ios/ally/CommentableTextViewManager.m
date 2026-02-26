#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(CommentableTextViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(text, NSString)
RCT_EXPORT_VIEW_PROPERTY(commentRanges, NSArray)
RCT_EXPORT_VIEW_PROPERTY(prefixLength, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(selection, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(selectableEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(multiline, BOOL)
RCT_EXPORT_VIEW_PROPERTY(textStyle, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(partTextStyle, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(prefixTextStyle, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(highlightStyle, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(onCommentableSelectionChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCommentPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCommentableContentSizeChange, RCTDirectEventBlock)
@end

