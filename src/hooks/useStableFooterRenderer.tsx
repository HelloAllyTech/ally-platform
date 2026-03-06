import {useCallback, useRef} from 'react';
import {BottomSheetFooter, BottomSheetFooterProps} from '@gorhom/bottom-sheet';

import {CommentBottomSheetFooter} from '@/components';

interface FooterState {
  text: string;
  setText: (text: string) => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  insetsBottom: number;
  isLoading: boolean;
}

export function useStableFooterRenderer(state: FooterState) {
  const stateRef = useRef(state);
  stateRef.current = state;

  const renderFooterComponent = useCallback((props: BottomSheetFooterProps) => {
    const current = stateRef.current;
    return (
      <BottomSheetFooter
        animatedFooterPosition={props.animatedFooterPosition}
        bottomInset={0}>
        <CommentBottomSheetFooter
          text={current.text}
          setText={current.setText}
          onSubmit={current.onSubmit}
          placeholder={current.placeholder}
          bottomInset={current.insetsBottom}
          isLoading={current.isLoading}
        />
      </BottomSheetFooter>
    );
  }, []);

  return renderFooterComponent;
}
