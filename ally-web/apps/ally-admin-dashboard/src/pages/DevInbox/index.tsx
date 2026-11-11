import React from "react";

import { Inbox } from "../Inbox";

/**
 * The inbox (chunk 11a) without the dashboard's sign-in, for the browser tests: they mock its API
 * (`e2e/inbox.fixture.ts`), as `/dev/assistant-home` does for the home. Development builds only.
 */
const DevInbox: React.FC = () => <Inbox />;

export default DevInbox;
