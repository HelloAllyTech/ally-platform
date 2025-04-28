import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {RootState} from '../store';

interface ExampleState {
  count: number;
}

const initialState: ExampleState = {
  count: 0,
};

export const exampleSlice = createSlice({
  name: 'example',
  initialState,
  reducers: {
    increment: state => {
      state.count += 1;
    },
    decrement: state => {
      state.count -= 1;
    },
    incrementByAmount: (state, action: PayloadAction<number>) => {
      state.count += action.payload;
    },
  },
});

export const {increment, decrement, incrementByAmount} = exampleSlice.actions;

export const selectCount = (state: RootState) => state.example.count;

export default exampleSlice.reducer;
