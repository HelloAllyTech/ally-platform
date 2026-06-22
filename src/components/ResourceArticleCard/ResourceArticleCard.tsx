import React, {useCallback, useMemo, useState} from 'react';
import {
  LayoutAnimation,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {DownArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {getThemedStyles} from './styles';

interface ResourceArticleCardProps {
  category: string;
  tags: string[];
  heading: string;
  content: string;
  colorTheme?: 'light' | 'dark';
}

const MAX_LINES = 3;

export const ResourceArticleCard: React.FC<ResourceArticleCardProps> = ({
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

  return (
    <View style={themedStyles.card}>
      <View style={themedStyles.topRow}>
        <View style={themedStyles.categoryChip}>
          <Text style={themedStyles.categoryText}>{category}</Text>
        </View>
        {renderedTags}
      </View>
      <View style={themedStyles.paddingH10}>
        <Text style={themedStyles.title}>{heading}</Text>
        {!expanded ? (
          <View style={themedStyles.contentRow}>
            <Text
              style={themedStyles.content}
              ellipsizeMode="head"
              numberOfLines={MAX_LINES}>
              {content}
            </Text>
            <TouchableOpacity
              style={themedStyles.moreButton}
              onPress={toggleExpand}
              activeOpacity={0.7}>
              <Text style={themedStyles.moreText}>{t('common.viewMore')}</Text>
              <DownArrowIcon
                color={colorTheme === 'dark' ? colors.white2 : colors.black}
                width={24}
                height={24}
              />
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
    </View>
  );
};
