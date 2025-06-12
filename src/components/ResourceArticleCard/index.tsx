import React, {useCallback, useMemo, useState} from 'react';
import {
  LayoutAnimation,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import useTranslate from '@/hooks/useTranslate';

import styles from './styles';

interface ResourceArticleCardProps {
  category: string;
  tags: string[];
  title: string;
  content: string;
}

const MAX_LINES = 3;

const ResourceArticleCard: React.FC<ResourceArticleCardProps> = ({
  category,
  tags = [],
  title,
  content,
}) => {
  const [expanded, setExpanded] = useState(false);
  const {t} = useTranslate();

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  }, []);

  const renderedTags = useMemo(
    () => (
      <View style={styles.tagsRow}>
        {tags.map((tag, idx) => (
          <View style={styles.tagChip} key={tag + idx}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
    ),
    [tags],
  );

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.categoryChip}>
          <Text style={styles.categoryText}>{category}</Text>
        </View>
        {renderedTags}
      </View>
      <Text style={styles.title}>{title}</Text>
      {!expanded ? (
        <View style={styles.contentRow}>
          <Text
            style={styles.content}
            numberOfLines={MAX_LINES}
            ellipsizeMode="tail">
            {content}
          </Text>
          <TouchableOpacity
            style={styles.moreButton}
            onPress={toggleExpand}
            activeOpacity={0.7}>
            <Text style={styles.moreText}>{t('ResourceArticleCard.more')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableWithoutFeedback onPress={toggleExpand}>
          <View style={styles.contentRow}>
            <Text style={styles.content}>{content}</Text>
          </View>
        </TouchableWithoutFeedback>
      )}
    </View>
  );
};

export default ResourceArticleCard;
