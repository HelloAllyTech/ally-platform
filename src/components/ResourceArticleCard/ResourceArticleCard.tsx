import React, {useCallback, useMemo, useState} from 'react';
import {
  LayoutAnimation,
  ScrollView,
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
  heading: string;
  content: string;
  colorTheme?: 'light' | 'dark';
}

const MAX_LINES = 3;

const ResourceArticleCard: React.FC<ResourceArticleCardProps> = ({
  category,
  tags = [],
  heading,
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tags.map((tag, idx) => (
          <View style={themedStyles.tagChip} key={tag + idx}>
            <Text style={themedStyles.tagText}>{tag}</Text>
          </View>
        ))}
      </ScrollView>
    ),
    [tags, themedStyles],
  );

  const formatLabel = (str: string) =>
    str
      .split('-')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return (
    <View style={themedStyles.card}>
      <View style={themedStyles.topRow}>
        <View style={themedStyles.categoryChip}>
          <Text style={themedStyles.categoryText}>{formatLabel(category)}</Text>
        </View>
        {renderedTags}
      </View>
      <Text style={themedStyles.title}>{heading}</Text>
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
              {`... ${t('ResourceArticleCard.more')}`}
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
