import { FC } from "react";

import type { StartArticleItemPayload } from "@types";

import { ArticleItemPlayer } from "../../../track-player/components/players/ArticleItemPlayer";

import type { ItemAdapterProps } from "./types";

/** Article, in the Shelf at reading width. The Shelf body doesn't scroll: the player's read gate owns scrolling. */
const ArticleAdapter: FC<ItemAdapterProps<StartArticleItemPayload>> = ({
  payload,
  itemId,
  alreadyCompleted,
  onCompleted,
}) => (
  <ArticleItemPlayer
    payload={payload}
    itemId={itemId}
    alreadyCompleted={alreadyCompleted}
    onCompleted={onCompleted}
  />
);

export default ArticleAdapter;
