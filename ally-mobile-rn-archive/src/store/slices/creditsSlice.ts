import {createSlice, PayloadAction} from '@reduxjs/toolkit';

import {SimulationCredits, SimulationCreditsState} from '@/types';

const initialState: SimulationCreditsState = {
  credits: null,
};

const creditsSlice = createSlice({
  name: 'credits',
  initialState,
  reducers: {
    setCredits: (state, action: PayloadAction<SimulationCredits>) => {
      state.credits = action.payload;
    },
    clearCredits: state => {
      state.credits = null;
    },
  },
});

export const {setCredits, clearCredits} = creditsSlice.actions;

export default creditsSlice.reducer;
