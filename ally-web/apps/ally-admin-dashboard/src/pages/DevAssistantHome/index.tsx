import React from "react";

import { Route, Routes } from "react-router-dom";

import { AssistantHome } from "../AssistantHome";

/**
 * Dev only: the assistant home without the dashboard's sign-in and sidebar, for the browser tests
 * (`e2e/assistantHome.e2e.ts`), which answer its API calls from fixtures.
 * `/dev/assistant-home/<botId>?section=…`.
 */
const DevAssistantHome: React.FC = () => (
  <Routes>
    <Route path=":botId" element={<AssistantHome />} />
  </Routes>
);

export default DevAssistantHome;
