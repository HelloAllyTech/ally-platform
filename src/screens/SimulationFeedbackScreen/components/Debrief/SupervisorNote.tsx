import React, {Fragment, useMemo, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {RankBadgeIcon} from '@/assets';
import {InfoTooltip} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {
  DebriefSection,
  isLabelledSectionKey,
  parseDebriefSections,
} from './debriefSections';
import {styles} from './styles';

/**
 * Ally anchors specific moments in the note as `[[msg:<messageId>]]`. The
 * learner never sees the raw id — it becomes a tappable chip that switches to
 * the Transcript tab. The note is written so every sentence still reads
 * correctly with its anchor removed, which is what lets us drop an anchor we
 * cannot resolve instead of rendering a dead control (mirrors ally-web's
 * SupervisorNote.tsx).
 */
const MOMENT_ANCHOR = /\[\[msg:([^\]]+)\]\]/g;

/** Inline `**bold**`, matching how the AskAI chat bubbles already render emphasis. */
const BOLD = /\*\*(.+?)\*\*/g;

type Segment =
  | {type: 'text'; value: string}
  | {type: 'bold'; value: string}
  | {type: 'moment'; messageId: string};

const parseSegments = (line: string): Segment[] => {
  const segments: Segment[] = [];
  const pattern = new RegExp(`${MOMENT_ANCHOR.source}|${BOLD.source}`, 'g');
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) {
      segments.push({type: 'text', value: line.slice(cursor, match.index)});
    }
    if (match[1] !== undefined) {
      segments.push({type: 'moment', messageId: match[1].trim()});
    } else if (match[2] !== undefined) {
      segments.push({type: 'bold', value: match[2]});
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < line.length) {
    segments.push({type: 'text', value: line.slice(cursor)});
  }
  return segments;
};

interface SupervisorNoteProps {
  note: string;
  /**
   * Switches to the annotated transcript. Undefined when that tab is off for
   * this roleplay (e.g. `feedbackTabs.transcript` is false) — anchors then
   * render as plain text rather than as chips that would go nowhere.
   */
  onOpenMoment?: (messageId: string) => void;
  /**
   * Drops the note's closing invitation to reply. Set where there is no reply
   * thread to accept one — the debrief opened from Logs — because a note that
   * ends "reply and we'll talk it through" next to nothing to reply in reads
   * like a broken screen. Only works on notes carrying the `[closing]` marker;
   * a note written before sections existed has the invitation buried in its
   * prose and keeps it.
   */
  hideClosing?: boolean;
}

export const SupervisorNote: React.FC<SupervisorNoteProps> = ({
  note,
  onOpenMoment,
  hideClosing = false,
}) => {
  const {t} = useTranslate();
  const [showAiTooltip, setShowAiTooltip] = useState(false);
  const sections = useMemo(() => {
    const parsed = parseDebriefSections(note);
    return hideClosing
      ? parsed.filter(section => section.key !== 'closing')
      : parsed;
  }, [note, hideClosing]);

  const renderParagraph = (paragraph: string, paragraphIndex: number) => (
    <Text key={paragraphIndex} style={styles.noteParagraph}>
      {paragraph.split('\n').map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? '\n' : null}
          {parseSegments(line).map((segment, segmentIndex) => {
            if (segment.type === 'bold') {
              return (
                <Text key={segmentIndex} style={styles.boldText}>
                  {segment.value}
                </Text>
              );
            }
            if (segment.type === 'moment') {
              if (!onOpenMoment) {
                return null;
              }
              return (
                <Text
                  key={segmentIndex}
                  style={styles.momentChip}
                  onPress={() => onOpenMoment(segment.messageId)}
                  suppressHighlighting>
                  {' '}
                  {t('postSim.debrief.momentLabel')}{' '}
                </Text>
              );
            }
            return <Text key={segmentIndex}>{segment.value}</Text>;
          })}
        </Fragment>
      ))}
    </Text>
  );

  const renderSection = (section: DebriefSection, sectionIndex: number) => (
    <View key={sectionIndex} style={styles.noteSection}>
      {isLabelledSectionKey(section.key) ? (
        <Text style={styles.noteSectionHeading}>
          {t(`postSim.debrief.section.${section.key}`)}
        </Text>
      ) : null}
      <View style={styles.noteSectionParagraphs}>
        {section.paragraphs.map(renderParagraph)}
      </View>
    </View>
  );

  return (
    <View style={styles.noteRow} testID="supervisor-note">
      <View style={styles.noteAvatar}>
        <LinearGradient
          colors={[colors.ds.blue[50], colors.white]}
          start={{x: 0, y: 0}}
          end={{x: 0, y: 1}}
          style={styles.noteAvatarGradient}>
          <RankBadgeIcon width={12} height={12} />
        </LinearGradient>
      </View>
      <View style={styles.noteBody}>
        <View style={styles.noteHeaderRow}>
          <Text style={styles.noteFromLabel}>{t('postSim.debrief.from')}</Text>
          {/* Disclosure sits next to the author, not buried in a footer: a
              note written in a supervisor's voice has to say plainly that a
              supervisor did not write it. */}
          <InfoTooltip
            content={
              <Text style={styles.tooltipText}>
                {t('postSim.debrief.aiTooltip')}
              </Text>
            }
            placement="top"
            isVisible={showAiTooltip}
            onClose={() => setShowAiTooltip(false)}>
            <TouchableOpacity
              onPress={() => setShowAiTooltip(true)}
              testID="debrief-ai-disclosure">
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>
                  {t('postSim.debrief.aiLabel')}
                </Text>
              </View>
            </TouchableOpacity>
          </InfoTooltip>
        </View>

        {/* An unsectioned note has exactly one child here and looks the way
            it always did. */}
        <View style={styles.noteSections}>{sections.map(renderSection)}</View>
      </View>
    </View>
  );
};
