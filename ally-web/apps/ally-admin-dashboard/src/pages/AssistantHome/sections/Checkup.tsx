import React from "react";

import { HOME } from "../copy";
import { Group, SectionHead } from "../fields";

/** The checkup (20a-2 fills this in); until then, when the first one will run. */
export const CheckupSection: React.FC = () => (
  <>
    <SectionHead title={HOME.sections.checkup} subtitle={HOME.subtitles.checkup} />
    <Group testId="checkup-empty">
      <p className="ally-empty">{HOME.checkup.empty}</p>
    </Group>
  </>
);
