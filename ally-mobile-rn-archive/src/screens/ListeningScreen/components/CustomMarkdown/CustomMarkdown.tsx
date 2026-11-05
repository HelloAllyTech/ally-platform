import React, {FunctionComponent} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const CustomMarkdown: FunctionComponent<{
  content: string;
  className?: string;
}> = ({content}) => {
  // Parses the markdown content into an array of React elements
  const parseMarkdown = (text: string) => {
    const lines = text.split('\n'); // Split the content line by line
    const parsedContent: React.ReactNode[] = []; // Stores the final JSX output

    // Track the current section type and its content
    let currentSection: {
      type: 'title' | 'list' | 'text';
      content: string[];
    } | null = null;

    // Parses a string line and converts bold markdown (**) to styled Text
    const parseBoldAndText = (line: string) => {
      const parts: React.ReactNode[] = [];
      let remainingText = line;

      const boldRegex = /\*\*(.*?)\*\*/;
      const segments = remainingText.split(/(\*\*.*?\*\*)/);

      segments.forEach((segment, index) => {
        const boldMatch = segment.match(boldRegex);
        if (boldMatch) {
          // This is a bold segment
          parts.push(
            <Text key={`bold-${index}`} style={styles.bold}>
              {boldMatch[1]}
            </Text>,
          );
        } else if (segment) {
          // This is regular text
          parts.push(<Text key={`text-${index}`}>{segment}</Text>);
        }
      });

      return parts.length > 0 ? parts : [<Text key="line">{line}</Text>];
    };

    // Finalize and push the current section into parsedContent[]
    const flushCurrentSection = () => {
      if (!currentSection) return;

      if (currentSection.type === 'title') {
        parsedContent.push(
          <Text key={`title-${parsedContent.length}`} style={styles.title}>
            {parseBoldAndText(currentSection.content[0])}
          </Text>,
        );
      } else if (currentSection.type === 'list') {
        parsedContent.push(
          <View key={`list-${parsedContent.length}`} style={styles.list}>
            {currentSection.content.map((item, idx) => (
              <View key={idx} style={styles.listItem}>
                <Text style={styles.bullet}>•</Text>
                <Text style={[styles.description, styles.listText]}>
                  {parseBoldAndText(item)}
                </Text>
              </View>
            ))}
          </View>,
        );
      } else if (currentSection.type === 'text') {
        parsedContent.push(
          <Text
            key={`text-${parsedContent.length}`}
            style={[styles.description, styles.paragraph]}>
            {currentSection.content.map((line, i) => (
              <Text key={i}>{parseBoldAndText(line)}</Text>
            ))}
          </Text>,
        );
      }

      currentSection = null; // Reset section tracker
    };

    // Iterate over each line and classify it as a title, list item, or paragraph
    lines.forEach((line, index) => {
      const titleMatch = line.match(/^(#{1,6})\s+(.+)/); // Match 1-6 # characters for different heading levels
      const listItemMatch = line.match(/^-\s*(.+)/); // List item (e.g. - Item)

      if (titleMatch) {
        flushCurrentSection();
        currentSection = {type: 'title', content: [titleMatch[2].trim()]};
      } else if (listItemMatch) {
        // Start a new list if needed
        if (!currentSection || currentSection.type !== 'list') {
          flushCurrentSection();
          currentSection = {type: 'list', content: [listItemMatch[1]]};
        } else {
          currentSection.content.push(listItemMatch[1]); // Add to current list
        }
      } else if (line.trim()) {
        // Regular paragraph text
        if (!currentSection || currentSection.type !== 'text') {
          flushCurrentSection();
          currentSection = {type: 'text', content: [line]};
        } else {
          currentSection.content.push(line); // Continue current paragraph
        }
      }

      // Ensure the final section is flushed at the end of parsing
      if (index === lines.length - 1) {
        flushCurrentSection();
      }
    });

    return parsedContent;
  };

  // Render parsed markdown as native components
  return <View style={styles.container}>{parseMarkdown(content)}</View>;
};

const styles = ScaledSheet.create({
  container: {
    paddingBottom: '4@s',
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    color: colors.lightCyan,
    lineHeight: '41@ms',
    fontSize: '16@ms',
    marginBottom: '4@s',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: '300',
    color: colors.paleBlue,
  },
  paragraph: {
    marginBottom: '8@s',
  },
  bold: {
    fontWeight: '600',
  },
  list: {
    marginBottom: '8@s',
    paddingLeft: '12@s',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: '4@s',
  },
  bullet: {
    marginRight: '6@s',
    color: colors.white,
  },
  listText: {
    flex: 1,
  },
});
