import React, {FunctionComponent} from 'react';
import {Text, View, StyleSheet} from 'react-native';

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

      // Continue until all bold (**text**) matches are processed
      while (remainingText.includes('**')) {
        const boldMatch = remainingText.match(/(.?)\*\*(.*?)\*\*(.*)$/);
        if (boldMatch) {
          // Text before bold part
          if (boldMatch[1]) {
            parts.push(
              <Text key={`text-${parts.length}`}>{boldMatch[1]}</Text>,
            );
          }

          // Bold part
          parts.push(
            <Text key={`bold-${parts.length}`} style={styles.bold}>
              {boldMatch[2]}
            </Text>,
          );

          // Remaining part of the line
          remainingText = boldMatch[3];
        } else {
          // No more matches; add remaining text
          parts.push(
            <Text key={`plain-${parts.length}`}>{remainingText}</Text>,
          );
          break;
        }
      }

      // Add any leftover text
      if (remainingText) {
        parts.push(<Text key={`remain-${parts.length}`}>{remainingText}</Text>);
      }

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
                <Text style={styles.listText}>{parseBoldAndText(item)}</Text>
              </View>
            ))}
          </View>,
        );
      } else if (currentSection.type === 'text') {
        parsedContent.push(
          <Text key={`text-${parsedContent.length}`} style={styles.paragraph}>
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
      const titleMatch = line.match(/^(#+)\s*(.+)/); // Heading (e.g. # Title)
      const listItemMatch = line.match(/^-\s*(.+)/); // List item (e.g. - Item)

      if (titleMatch) {
        flushCurrentSection();
        currentSection = {type: 'title', content: [titleMatch[2]]};
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

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: '#FFFFFF',
  },
  paragraph: {
    fontSize: 14,
    marginBottom: 8,
    color: '#FFFFFF',
  },
  bold: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  list: {
    marginBottom: 8,
    paddingLeft: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  bullet: {
    marginRight: 6,
    color: '#FFFFFF',
  },
  listText: {
    flex: 1,
    color: '#FFFFFF',
  },
});
