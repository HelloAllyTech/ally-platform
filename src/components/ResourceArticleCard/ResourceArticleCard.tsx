import React, {useCallback, useMemo, useState} from 'react';
import {
  LayoutAnimation,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import useTranslate from '@/hooks/useTranslate';

import {getThemedStyles} from './styles';

interface ResourceArticleCardProps {
  category: string;
  tags: string[];
  title: string;
  content: string;
  colorTheme?: 'light' | 'dark';
}

const MAX_LINES = 3;

const ResourceArticleCard: React.FC<ResourceArticleCardProps> = ({
  category,
  tags = [],
  title,
  content,
  colorTheme = 'light',
}) => {
  const [expanded, setExpanded] = useState(false);
  const {t} = useTranslate();

  const themedStyles = useMemo(() => getThemedStyles(colorTheme), [colorTheme]);

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  }, []);

  const renderedTags = useMemo(
    () => (
      <View style={themedStyles.tagsRow}>
        {tags.map((tag, idx) => (
          <View style={themedStyles.tagChip} key={tag + idx}>
            <Text style={themedStyles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
    ),
    [tags, themedStyles],
  );

  return (
    <View style={themedStyles.card}>
      <View style={themedStyles.topRow}>
        <View style={themedStyles.categoryChip}>
          <Text style={themedStyles.categoryText}>{category}</Text>
        </View>
        {renderedTags}
      </View>
      <Text style={themedStyles.title}>{title}</Text>
      {!expanded ? (
        <View style={themedStyles.contentRow}>
          <Text
            style={themedStyles.content}
            numberOfLines={MAX_LINES}
            ellipsizeMode="tail">
            {content}
          </Text>
          <TouchableOpacity
            style={themedStyles.moreButton}
            onPress={toggleExpand}
            activeOpacity={0.7}>
            <Text style={themedStyles.moreText}>
              {t('ResourceArticleCard.more')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableWithoutFeedback onPress={toggleExpand}>
          <View style={themedStyles.contentRow}>
            <Text style={themedStyles.content}>{content}</Text>
          </View>
        </TouchableWithoutFeedback>
      )}
    </View>
  );
};

export default ResourceArticleCard;
