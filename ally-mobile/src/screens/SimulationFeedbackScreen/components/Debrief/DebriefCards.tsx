import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {useTranslate} from '@/hooks';
import {
  useFlagDebriefCardMutation,
  useSetDebriefHelpfulMutation,
  useUndoDebriefFlagMutation,
} from '@/services/learnerDebriefApi';
import {colors} from '@/theme';
import {
  DebriefCorrection,
  DebriefFlagReason,
  DebriefMyFlag,
  DebriefSkillWord,
  LearnerDebriefView,
} from '@/types';

import {cardStyles as s} from './cardStyles';
import {styles} from './styles';

const REASONS: DebriefFlagReason[] = [
  'didnt_say',
  'described_wrongly',
  'advice_doesnt_fit',
  'something_else',
];

/** Text plus a symbol, never colour alone. */
const SKILL_WORD_SYMBOL: Record<DebriefSkillWord, string> = {
  strength: '★',
  keep_practising: '↗',
  didnt_come_up: '○',
};

const canUndo = (flag?: DebriefMyFlag) =>
  !!flag?.canUndoUntil && new Date(flag.canUndoUntil).getTime() > Date.now();

/** "This isn't right" for one card, or what the Ally team decided about it. */
const CardFlag: React.FC<{
  sessionId: string;
  section: string;
  cardLabel: string;
  flag?: DebriefMyFlag;
  correction?: DebriefCorrection;
}> = ({sessionId, section, cardLabel, flag, correction}) => {
  const {t} = useTranslate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DebriefFlagReason | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const [sendFlag, {isLoading: sending}] = useFlagDebriefCardMutation();
  const [undoFlag, {isLoading: undoing}] = useUndoDebriefFlagMutation();
  // Re-render when the undo window closes, so Undo does not outlive it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!canUndo(flag)) {
      return undefined;
    }
    const ms = new Date(flag!.canUndoUntil!).getTime() - Date.now();
    const timer = setTimeout(() => tick(n => n + 1), ms + 50);
    return () => clearTimeout(timer);
  }, [flag]);

  if (correction?.outcome === 'kept') {
    return (
      <Text style={s.smallText} testID="debrief-correction">
        {t('postSim.debriefCards.corrections.kept', {
          note: correction.note ?? '',
        })}
      </Text>
    );
  }
  if (flag) {
    return (
      <View style={s.row} accessibilityLiveRegion="polite">
        <Text style={s.smallText}>
          {canUndo(flag)
            ? t('postSim.debriefCards.flag.sent')
            : t('postSim.debriefCards.flag.waiting')}
        </Text>
        {canUndo(flag) && (
          <TouchableOpacity
            accessibilityRole="button"
            style={s.linkButton}
            disabled={undoing}
            onPress={() => {
              undoFlag({sessionId, flagId: flag.id});
            }}>
            <Text style={s.linkText}>
              {t('postSim.debriefCards.flag.undo')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  if (!open) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('postSim.debriefCards.flag.openLabel', {
          card: cardLabel,
        })}
        style={s.linkButton}
        onPress={() => setOpen(true)}>
        <Text style={s.linkText}>{t('postSim.debriefCards.flag.open')}</Text>
      </TouchableOpacity>
    );
  }

  const submit = async () => {
    if (!reason) {
      return;
    }
    setFailed(false);
    try {
      await sendFlag({
        sessionId,
        section,
        reason,
        note: note.trim() || undefined,
      }).unwrap();
      setOpen(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <View style={s.flagForm} testID="debrief-flag-form">
      <Text style={s.flagQuestion} accessibilityRole="header">
        {t('postSim.debriefCards.flag.question')}
      </Text>
      {REASONS.map(r => (
        <TouchableOpacity
          key={r}
          accessibilityRole="radio"
          accessibilityState={{checked: reason === r}}
          style={s.reasonRow}
          onPress={() => setReason(r)}>
          <View style={[s.radio, reason === r && s.radioOn]} />
          <Text style={s.bodyText}>
            {t(`postSim.debriefCards.flag.reasons.${r}`)}
          </Text>
        </TouchableOpacity>
      ))}
      <Text style={s.smallText}>
        {t('postSim.debriefCards.flag.noteLabel')}
      </Text>
      <TextInput
        style={s.noteInput}
        multiline
        maxLength={1000}
        value={note}
        onChangeText={setNote}
        accessibilityLabel={t('postSim.debriefCards.flag.noteLabel')}
      />
      {failed && (
        <Text style={s.bodyText} accessibilityLiveRegion="assertive">
          {t('postSim.debriefCards.flag.failed')}
        </Text>
      )}
      <View style={s.row}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{disabled: !reason || sending}}
          disabled={!reason || sending}
          style={[s.primaryButton, (!reason || sending) && s.disabled]}
          onPress={() => {
            submit();
          }}>
          <Text style={s.primaryButtonText}>
            {sending
              ? t('postSim.debriefCards.flag.sending')
              : t('postSim.debriefCards.flag.send')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={s.linkButton}
          onPress={() => setOpen(false)}>
          <Text style={s.linkText}>
            {t('postSim.debriefCards.flag.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const Helpful: React.FC<{sessionId: string; helpful: boolean | null}> = ({
  sessionId,
  helpful,
}) => {
  const {t} = useTranslate();
  const [setHelpful, {isLoading}] = useSetDebriefHelpfulMutation();
  const choice = (value: boolean, label: string) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{selected: helpful === value, disabled: isLoading}}
      disabled={isLoading}
      style={[s.choice, helpful === value && s.choiceOn]}
      onPress={() => {
        setHelpful({sessionId, helpful: value});
      }}>
      <Text style={s.bodyText}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={s.helpful} testID="debrief-helpful">
      <Text style={s.cardTitle}>
        {t('postSim.debriefCards.helpful.question')}
      </Text>
      <View style={s.row}>
        {choice(true, t('postSim.debriefCards.helpful.yes'))}
        {choice(false, t('postSim.debriefCards.helpful.no'))}
      </View>
      {helpful !== null && (
        <Text style={s.smallText}>
          {t('postSim.debriefCards.helpful.thanks')}
        </Text>
      )}
    </View>
  );
};

const Card: React.FC<{
  title: string;
  attention?: boolean;
  testID?: string;
  children: React.ReactNode;
}> = ({title, attention, testID, children}) => (
  <View style={[s.card, attention && s.cardAttention]} testID={testID}>
    <Text style={s.cardTitle} accessibilityRole="header">
      {title}
    </Text>
    {children}
  </View>
);

const Quote: React.FC<{text: string}> = ({text}) => (
  <Text style={s.quote}>“{text}”</Text>
);

/**
 * The Debrief agent's debrief as cards, in the plan's order. No score and no
 * red: amber marks what needs attention, and every status carries text.
 * Mounted only when the learner's organisation is switched on.
 */
export const DebriefCards: React.FC<{
  view: LearnerDebriefView;
  sessionId: string;
}> = ({view, sessionId}) => {
  const {t} = useTranslate();
  const latestStep = view.steps?.length
    ? view.steps[view.steps.length - 1]
    : undefined;

  let content: React.ReactNode = null;
  if (view.state === 'working') {
    content = (
      <View
        style={s.working}
        testID="debrief-working"
        accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.ds.blue[500]} />
        <View style={s.workingText}>
          <Text style={s.cardTitle}>
            {t('postSim.debriefCards.working.title')}
          </Text>
          <Text style={s.bodyText}>
            {latestStep || t('postSim.debriefCards.working.defaultStep')}
          </Text>
        </View>
      </View>
    );
  } else if (view.state === 'on_its_way') {
    content = (
      <Text style={s.bodyText}>{t('postSim.debriefCards.onItsWay')}</Text>
    );
  } else if (view.state === 'too_short') {
    content = (
      <Text style={s.bodyText}>{t('postSim.debriefCards.tooShort')}</Text>
    );
  } else if (view.state === 'ready' && view.cards) {
    const cards = view.cards;
    const corrections = view.corrections ?? [];
    // Sections keep their stored index — the one a flag and a correction name.
    const removed = new Set(
      corrections.filter(c => c.outcome === 'removed').map(c => c.section),
    );
    const flagControl = (section: string, cardLabel: string) => (
      <CardFlag
        sessionId={sessionId}
        section={section}
        cardLabel={cardLabel}
        flag={view.feedback?.flags.find(f => f.section === section)}
        correction={corrections.find(c => c.section === section)}
      />
    );
    const moment = removed.has('important_moment')
      ? null
      : cards.important_moment;
    const worked = cards.what_worked
      .map((item, index) => ({item, index}))
      .filter(({index}) => !removed.has(`what_worked[${index}]`));
    const growth = cards.work_on_this
      .map((item, index) => ({item, index}))
      .filter(({index}) => !removed.has(`work_on_this[${index}]`));
    const practise = removed.has('practise_next') ? null : cards.practise_next;

    content = (
      <View style={s.stack}>
        {moment && (
          <Card
            title={t('postSim.debriefCards.importantMoment.title')}
            attention
            testID="debrief-card-important-moment">
            <Text style={s.lead}>{moment.lead}</Text>
            <Quote text={moment.quote} />
            <Text style={s.bodyText}>{moment.body}</Text>
            {!!moment.others?.length && (
              <View testID="debrief-other-moments">
                <Text style={s.lead}>
                  {t('postSim.debriefCards.importantMoment.others')}
                </Text>
                {moment.others.map(other => (
                  <View key={other.turn_index} style={s.item}>
                    <Quote text={other.quote} />
                    <Text style={s.bodyText}>{other.note}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={s.bodyText}>
              {t('postSim.debriefCards.importantMoment.support')}
            </Text>
            {flagControl(
              'important_moment',
              t('postSim.debriefCards.importantMoment.title'),
            )}
          </Card>
        )}

        <Text style={s.opening} testID="debrief-card-opening">
          {cards.opening}
        </Text>

        {worked.length > 0 && (
          <Card
            title={t('postSim.debriefCards.whatWorked')}
            testID="debrief-card-what-worked">
            {worked.map(({item, index}) => (
              <View key={`${item.turn_index}-${index}`} style={s.item}>
                <Text style={s.lead}>{item.lead}</Text>
                <Quote text={item.quote} />
                <Text style={s.bodyText}>{item.body}</Text>
                {flagControl(`what_worked[${index}]`, item.lead)}
              </View>
            ))}
          </Card>
        )}

        {growth.length > 0 && (
          <Card
            title={t('postSim.debriefCards.workOnThis')}
            testID="debrief-card-work-on-this">
            {growth.map(({item, index}) => (
              <View key={`${item.turn_index}-${index}`} style={s.item}>
                <Text style={s.lead}>{item.lead}</Text>
                <Quote text={item.quote} />
                <Text style={s.bodyText}>{item.why}</Text>
                <Text style={s.trySaying} testID="debrief-try-saying">
                  <Text style={s.trySayingLabel}>
                    {t('postSim.debriefCards.trySaying')}
                  </Text>{' '}
                  {item.try_saying}
                </Text>
                {flagControl(`work_on_this[${index}]`, item.lead)}
              </View>
            ))}
          </Card>
        )}

        {practise && (
          <Card
            title={t('postSim.debriefCards.practiseNext')}
            testID="debrief-card-practise-next">
            <Text style={s.lead}>{practise.skill}</Text>
            <Text style={s.bodyText}>{practise.reason}</Text>
            {flagControl(
              'practise_next',
              t('postSim.debriefCards.practiseNext'),
            )}
          </Card>
        )}

        {cards.skill_words.length > 0 && (
          <Card
            title={t('postSim.debriefCards.skillWords.title')}
            testID="debrief-card-skill-words">
            {cards.skill_words.map(({skill, word}) => (
              <Text key={skill} style={s.bodyText}>
                <Text style={s.lead}>{skill}</Text>
                {'  '}
                {SKILL_WORD_SYMBOL[word]}{' '}
                {t(`postSim.debriefCards.skillWords.${word}`)}
              </Text>
            ))}
          </Card>
        )}

        {!!cards.progress_note && (
          <Card title={t('postSim.debriefCards.progressNote')}>
            <Text style={s.bodyText}>{cards.progress_note}</Text>
          </Card>
        )}

        <Card
          title={t('postSim.debriefCards.reflectiveQuestion')}
          testID="debrief-card-reflective-question">
          <Text style={s.bodyText}>{cards.reflective_question}</Text>
        </Card>

        {removed.size > 0 && (
          <Text style={s.smallText} testID="debrief-removed-note">
            {t('postSim.debriefCards.corrections.removed')}
          </Text>
        )}
        <Helpful
          sessionId={sessionId}
          helpful={view.feedback?.helpful ?? null}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[
          colors.ds.blue[500],
          colors.ds.blue[100],
          colors.ds.brand.logo,
        ]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
        style={styles.gradientContainer}>
        <View style={[styles.header, s.headerRow]}>
          <Text style={styles.headerText}>
            {t('postSim.debriefCards.header')}
          </Text>
          <Text style={s.aiLabel}>{t('postSim.debriefCards.aiLabel')}</Text>
        </View>
        <View style={styles.contentContainer}>
          <View style={styles.content}>
            <ScrollView
              contentContainerStyle={s.scroll}
              keyboardShouldPersistTaps="handled"
              testID="debrief-cards">
              {content}
            </ScrollView>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};
