import { FC, useState } from "react";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import { useGetCastSheetsQuery, useGetImageStylesQuery } from "@api";
import { useSlotImageJobs } from "@hooks/useImageStudioJobs";
import { ImageContext, ImageStyle } from "@types";

import { IMAGE_STUDIO_COPY as copy } from "./copy";
import { GenerateImageModal } from "./GenerateImageModal";
import { StyleThumbnail } from "./StyleGallery";

export interface CastSheetsSectionProps {
  characterId: string;
  characterName: string;
  /** The character's portrait, offered as a `character` reference. */
  portraitUrl?: string;
  context?: ImageContext;
}

export const castSheetSlotKey = (characterId: string, styleId: string) =>
  `character:${characterId}:cast_sheet:${styleId}`;

const CastSheetRow: FC<{
  style: ImageStyle;
  sheetUrl?: string;
  characterName: string;
  onCreate: () => void;
  slotKey: string;
}> = ({ style, sheetUrl, characterName, onCreate, slotKey }) => {
  const { pendingCount, readyCount } = useSlotImageJobs(slotKey);
  return (
    <li className="flex items-center gap-3">
      {sheetUrl ? (
        <CustomImage
          src={sheetUrl}
          alt={copy.castSheetAlt(characterName, style.name)}
          className="h-12 w-20 shrink-0 rounded-md bg-gray-100 object-cover"
        />
      ) : (
        <StyleThumbnail style={style} className="h-12 w-20 shrink-0 rounded-md opacity-60" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-typography-800">{style.name}</span>
      <button
        type="button"
        onClick={onCreate}
        className="shrink-0 text-xs font-medium text-primary-500 hover:text-primary-600"
      >
        {pendingCount > 0
          ? copy.castSheetGenerating
          : readyCount > 0
            ? copy.chipReady(readyCount)
            : sheetUrl
              ? copy.castSheetReplace
              : copy.castSheetCreate}
      </button>
    </li>
  );
};

/**
 * Character → Cast sheets: per style, the accepted sheet or "Create cast
 * sheet". Scenes the character is cast in send the sheet for that style as a
 * reference (server-side), which keeps their face the same. Loaded on demand.
 */
const CastSheetsSection: FC<CastSheetsSectionProps> = ({
  characterId,
  characterName,
  portraitUrl,
  context,
}) => {
  const { data: styles = [] } = useGetImageStylesQuery();
  const { data: sheets = [] } = useGetCastSheetsQuery({ characterIds: [characterId] });
  const [openStyleId, setOpenStyleId] = useState<string | null>(null);

  const sheetFor = (styleId: string) =>
    sheets.find(sheet => sheet.characterId === characterId && sheet.styleId === styleId)?.image
      .imageUrl;

  return (
    <div className="flex flex-col gap-2" data-testid="cast-sheets">
      <p className="text-xs text-typography-500">{copy.castSheetsHelp}</p>
      <ul className="flex flex-col gap-2">
        {styles.map(style => (
          <CastSheetRow
            key={style.id}
            style={style}
            sheetUrl={sheetFor(style.id)}
            characterName={characterName}
            slotKey={castSheetSlotKey(characterId, style.id)}
            onCreate={() => setOpenStyleId(style.id)}
          />
        ))}
      </ul>
      {openStyleId && (
        <GenerateImageModal
          slotKind="cast_sheet"
          slotKey={castSheetSlotKey(characterId, openStyleId)}
          initialStyleId={openStyleId}
          castCharacterIds={[characterId]}
          context={context}
          title={`${copy.castSheetCreate}: ${characterName || "character"}`}
          referenceOptions={
            portraitUrl
              ? {
                  suggested: [
                    {
                      key: "portrait",
                      role: "character",
                      label: characterName || "Portrait",
                      thumbnailUrl: portraitUrl,
                      url: portraitUrl,
                      selected: true,
                    },
                  ],
                }
              : undefined
          }
          onAccept={() => setOpenStyleId(null)}
          onClose={() => setOpenStyleId(null)}
        />
      )}
    </div>
  );
};

export default CastSheetsSection;
