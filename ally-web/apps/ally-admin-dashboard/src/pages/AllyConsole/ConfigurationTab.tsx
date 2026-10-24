import React, { useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideConfigAuditQuery,
  useGetAllyGuideConfigOverridesQuery,
  useGetAllyGuideConfigSchemaQuery,
} from "@api";
import { describeValue, groupFields } from "@components/ally-guide/configDraft";
import { ConfigAuditTable } from "@components/ally-guide/ConfigForm";
import { ConfigLayerEditor } from "@components/ally-guide/ConfigLayerEditor";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { CoursePicker, PickedCourse } from "@components/ally-guide/CoursePicker";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { formatDateTime } from "@utils";

const AUDIT_LIMIT = 30;

const Heading: React.FC<{ id: string; text: string; help?: string }> = ({ id, text, help }) => (
  <div className="flex items-center gap-1">
    <h3 id={id} className="text-xl font-normal text-typography-900">
      {text}
    </h3>
    {help && <InfoTip label={help} ariaLabel={`About ${text}`} />}
  </div>
);

/**
 * The configuration plane (plan §7.5): every setting Ally runs on, where it is overridden, the
 * recent changes, and the editor for a course's own overrides. An organisation's overrides are
 * edited on its own page (Organization detail, Ally tab, behind `ally_guide_org`), so they appear
 * here only as a read-only list.
 */
export const ConfigurationTab: React.FC = () => {
  const strings = en.allyConsole.config;
  const { canEdit } = useAllyGuideAccess();
  const [course, setCourse] = useState<PickedCourse | null>(null);

  const overrides = useGetAllyGuideConfigOverridesQuery();
  const audit = useGetAllyGuideConfigAuditQuery({ limit: AUDIT_LIMIT });
  const schema = useGetAllyGuideConfigSchemaQuery();

  return (
    <div className="flex flex-col gap-10" data-testid="ally-configuration">
      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>

      <section className="flex flex-col gap-3" aria-labelledby="config-overrides-heading">
        <Heading
          id="config-overrides-heading"
          text={strings.overridesHeading}
          help={strings.overridesHelp}
        />
        {overrides.isLoading ? (
          <LoadingBlock lines={3} />
        ) : overrides.isError || !overrides.data ? (
          <ErrorPanel
            what="the overrides"
            error={overrides.error}
            onRetry={() => void overrides.refetch()}
          />
        ) : overrides.data.length === 0 ? (
          <p className="text-sm text-typography-700" data-testid="config-overrides-empty">
            {strings.overridesEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              className="w-full border-collapse text-left"
              data-testid="config-overrides-table"
            >
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.overridesColumns.layer}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.overridesColumns.name}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.overridesColumns.settings}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.overridesColumns.changed}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.overridesColumns.by}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {overrides.data.map(row => (
                  <TableRow
                    key={`${row.layer}-${row.scopeId}`}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="config-override-row"
                  >
                    <TableCell className="py-3 pr-4">
                      <Pill tone="neutral">{strings.layers[row.layer] ?? row.layer}</Pill>
                    </TableCell>
                    <TableCell className="py-3 pr-4">{row.scopeName ?? strings.unnamed}</TableCell>
                    <TableCell className="py-3 pr-4">
                      <span className="block">
                        {strings.settingsCount(Object.keys(row.values).length)}
                      </span>
                      <span className="block break-words font-mono text-xs text-typography-700">
                        {Object.entries(row.values)
                          .map(([key, value]) => `${key} = ${describeValue(value)}`)
                          .join(", ")}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(row.updatedAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">{row.updatedBy ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="config-course-heading">
        <Heading id="config-course-heading" text={strings.courseHeading} />
        <p className="max-w-3xl text-sm text-typography-700">{strings.courseIntro}</p>
        <div className="max-w-md">
          <CoursePicker value={course} onChange={setCourse} idPrefix="ally-config-course" />
        </div>
        {course && (
          <div data-testid="config-course-editor">
            <ConfigLayerEditor
              key={course.id}
              layer="course"
              scopeId={course.id}
              canEdit={canEdit}
              what="this course's settings"
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="config-audit-heading">
        <Heading id="config-audit-heading" text={strings.auditHeading} help={strings.auditHelp} />
        {audit.isLoading ? (
          <LoadingBlock lines={3} />
        ) : audit.isError || !audit.data ? (
          <ErrorPanel what="the changes" error={audit.error} onRetry={() => void audit.refetch()} />
        ) : audit.data.length === 0 ? (
          <p className="text-sm text-typography-700" data-testid="config-audit-empty">
            {strings.auditEmpty}
          </p>
        ) : (
          <ConfigAuditTable rows={audit.data} showScope />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="config-reference-heading">
        <Heading
          id="config-reference-heading"
          text={strings.referenceHeading}
          help={strings.referenceHelp}
        />
        {schema.isLoading ? (
          <LoadingBlock lines={5} />
        ) : schema.isError || !schema.data ? (
          <ErrorPanel
            what="the settings"
            error={schema.error}
            onRetry={() => void schema.refetch()}
          />
        ) : (
          groupFields(schema.data.fields).map(([group, fields]) => (
            <div key={group} className="flex flex-col gap-1">
              <h4 className="text-lg font-normal text-typography-900">{group}</h4>
              <div className="overflow-x-auto">
                <Table
                  className="w-full border-collapse text-left"
                  data-testid={`config-reference-${group}`}
                >
                  <TableHead>
                    <TableRow className="border-b border-border-light text-sm text-typography-700">
                      <TableHeader className="py-2 pr-4 font-medium">
                        {strings.referenceColumns.setting}
                      </TableHeader>
                      <TableHeader className="py-2 pr-4 font-medium">
                        {strings.referenceColumns.release}
                      </TableHeader>
                      <TableHeader className="py-2 pr-4 font-medium">
                        {strings.referenceColumns.who}
                      </TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fields.map(field => (
                      <TableRow
                        key={field.key}
                        className="border-b border-border-light align-top text-sm text-typography-900"
                      >
                        <TableCell className="py-2 pr-4">
                          <span className="block font-mono text-xs">{field.key}</span>
                          <span className="block max-w-xl text-typography-700">
                            {field.description}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 pr-4 tabular-nums">
                          {describeValue(field.releaseValue, field.unit ?? null, strings.form)}
                        </TableCell>
                        <TableCell className="py-2 pr-4">
                          {field.pinned ? (
                            <Pill tone="warning" title={strings.pinned}>
                              {strings.pinned}
                            </Pill>
                          ) : field.overridableBy.length === 0 ? (
                            strings.nobody
                          ) : (
                            field.overridableBy.map(layer => strings.who[layer] ?? layer).join(", ")
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
};
