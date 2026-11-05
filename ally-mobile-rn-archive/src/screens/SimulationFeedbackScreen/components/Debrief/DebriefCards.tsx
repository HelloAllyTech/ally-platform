import React, {useEffect, useRef, useState} from 'react';
import i18next from 'i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import {
  useFlagDebriefCardMutation,
  useSetDebriefHelpfulMutation,
  useUndoDebriefFlagMutation,
} from '@/services/learnerDebriefApi';
import {useLazyGetScenarioByIdQuery} from '@/services/simulationsApi';
import {colors} from '@/theme';
import {
  DebriefCardsData,
  DebriefCorrection,
  DebriefFlagReason,
  DebriefMyFlag,
  DebriefPractice,
  DebriefProgress,
  DebriefSkillWord,
  DebriefSupportLine,
  LearnerDebriefView,
} from '@/types';

import {cardStyles as s} from './cardStyles';
import {
  ListenAllBar,
  ListenButton,
  ReadAloudContext,
  ReadAloudPlayer,
  ReadAloudStatusLine,
  useIsBeingRead,
} from './ReadAloudControls';
import {styles} from './styles';
import {useDebriefReadAloud} from './useDebriefReadAloud';
import {useMarkOpened, useReadToTheEnd} from './useReadToTheEnd';

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

/** A medium date in the app's language, e.g. "2 Nov 2026". */
const formatCorrectionDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleDateString(i18next.language, {dateStyle: 'medium'});
  } catch {
    // An engine without `dateStyle` still gets a date.
    return date.toLocaleDateString();
  }
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

  if (correction?.outcome === 'corrected') {
    // The card already shows the new words; say when and why.
    return (
      <Text style={s.smallText} testID="debrief-correction">
        {t('postSim.debriefCards.corrections.corrected', {
          date: correction.at ? formatCorrectionDate(correction.at) : '',
          note: correction.note ?? '',
        })}
      </Text>
    );
  }
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
  /** The section read-aloud reads for this card, for its highlight. */
  readSection?: string;
  children: React.ReactNode;
}> = ({title, attention, testID, readSection, children}) => {
  const reading = useIsBeingRead(readSection ?? '');
  return (
    <View
      style={[s.card, attention && s.cardAttention, reading && s.reading]}
      testID={testID}
      accessibilityState={reading ? {selected: true} : undefined}>
      <Text style={s.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
};

/** A card item that gets a highlight while read-aloud is reading it. */
const ReadableItem: React.FC<{section: string; children: React.ReactNode}> = ({
  section,
  children,
}) => {
  const reading = useIsBeingRead(section);
  return (
    <View
      style={[s.item, s.readableItem, reading && s.reading]}
      accessibilityState={reading ? {selected: true} : undefined}>
      {children}
    </View>
  );
};

const Quote: React.FC<{text: string}> = ({text}) => (
  <Text style={s.quote}>“{text}”</Text>
);

/** The organisation's support lines, each number a tap-to-call link. */
const SupportLines: React.FC<{lines: DebriefSupportLine[]}> = ({lines}) => (
  <View style={s.supportLines} testID="debrief-support-lines">
    {lines.map(line => (
      <View key={`${line.name}-${line.phone}`}>
        <TouchableOpacity
          accessibilityRole="link"
          style={s.supportLine}
          onPress={() => {
            Linking.openURL(`tel:${line.phone.replace(/[^\d+]/g, '')}`).catch(
              () => {},
            );
          }}>
          <Text style={s.supportLineText}>
            {line.name} · {line.phone}
          </Text>
        </TouchableOpacity>
        {!!line.hours && <Text style={s.supportHours}>{line.hours}</Text>}
      </View>
    ))}
  </View>
);

/**
 * "Practise this next" / "Practise this": opens the roleplay's own details
 * screen — the same one the Simulations list opens — so its language choice
 * and trigger warnings come first. Rendered only for a roleplay the server
 * says the learner can still open. The details screen takes the whole
 * scenario, so it is fetched by id on the tap.
 */
const PractiseButton: React.FC<{
  scenario: DebriefPractice;
  primary?: boolean;
}> = ({scenario, primary}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const [getScenario, {isFetching}] = useLazyGetScenarioByIdQuery();
  const open = async () => {
    try {
      const full = await getScenario({id: String(scenario.id)}, true).unwrap();
      navigation.navigate(SCREEN_NAMES.SIMULATION_DETAILS, {scenario: full});
    } catch {
      // Nothing to open; the button stays for another try.
    }
  };
  return (
    <TouchableOpacity
      accessibilityRole="link"
      accessibilityLabel={t('postSim.debriefCards.practise.label', {
        title: scenario.title,
      })}
      accessibilityState={{disabled: isFetching}}
      disabled={isFetching}
      testID={primary ? 'debrief-practise-next' : 'debrief-practise-this'}
      style={[
        primary ? s.primaryButton : s.practiseLink,
        primary && s.practiseLink,
        isFetching && s.disabled,
      ]}
      onPress={() => {
        open();
      }}>
      <Text style={primary ? s.primaryButtonText : s.practiseLinkText}>
        {primary
          ? t('postSim.debriefCards.practise.next')
          : t('postSim.debriefCards.practise.this')}
      </Text>
    </TouchableOpacity>
  );
};

/** The cards "Listen all" reads, in the order they appear; removed ones never. */
export const readableSections = (view: LearnerDebriefView): string[] => {
  const cards = view.cards;
  if (!cards) {
    return [];
  }
  const removed = new Set(
    (view.corrections ?? [])
      .filter(c => c.outcome === 'removed')
      .map(c => c.section),
  );
  return [
    cards.important_moment ? 'important_moment' : null,
    'opening',
    ...cards.what_worked.map((_, i) => `what_worked[${i}]`),
    ...cards.work_on_this.map((_, i) => `work_on_this[${i}]`),
    cards.practise_next ? 'practise_next' : null,
    cards.reflective_question ? 'reflective_question' : null,
  ].filter((x): x is string => !!x && !removed.has(x));
};

const ReadyCards: React.FC<{
  cards: DebriefCardsData;
  view: LearnerDebriefView;
  sessionId: string;
  replyThread?: React.ReactNode;
  /** The end of the last Work-on-this card, for DEBRIEF_READ XP. */
  readEndRef: React.RefObject<View | null>;
  onReadEndLayout: () => void;
  /** Read-only (Logs): reading it back isn't the learner opening it. */
  readOnly: boolean;
  /** Owned by DebriefCards, so a remount never sends "opened" twice. */
  openedSent: React.MutableRefObject<boolean>;
}> = ({
  cards,
  view,
  sessionId,
  replyThread,
  readEndRef,
  onReadEndLayout,
  readOnly,
  openedSent,
}) => {
  const {t} = useTranslate();
  // Mounted only while the ready cards are on screen (not while the distress
  // panel keeps them collapsed).
  useMarkOpened(sessionId, !readOnly, openedSent);
  const corrections = view.corrections ?? [];
  // Sections keep their stored index — the one a flag and a correction name.
  const removed = new Set(
    corrections.filter(c => c.outcome === 'removed').map(c => c.section),
  );
  const flagControl = (section: string, cardLabel: string) => (
    <View style={s.controlsRow}>
      <ListenButton section={section} cardLabel={cardLabel} />
      <CardFlag
        sessionId={sessionId}
        section={section}
        cardLabel={cardLabel}
        flag={view.feedback?.flags.find(f => f.section === section)}
        correction={corrections.find(c => c.section === section)}
      />
    </View>
  );
  const practiceFor = (id?: number | null) =>
    id === null || id === undefined
      ? undefined
      : view.practice?.find(p => p.id === id);
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
  const practiseNextScenario = practiceFor(practise?.scenario_id);

  return (
    <View style={s.stack}>
      {moment && (
        <Card
          title={t('postSim.debriefCards.importantMoment.title')}
          attention
          readSection="important_moment"
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
          {!!view.supportLines?.length && (
            <SupportLines lines={view.supportLines} />
          )}
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
            <ReadableItem
              key={`${item.turn_index}-${index}`}
              section={`what_worked[${index}]`}>
              <Text style={s.lead}>{item.lead}</Text>
              <Quote text={item.quote} />
              <Text style={s.bodyText}>{item.body}</Text>
              {flagControl(`what_worked[${index}]`, item.lead)}
            </ReadableItem>
          ))}
        </Card>
      )}

      {growth.length > 0 && (
        <Card
          title={t('postSim.debriefCards.workOnThis')}
          testID="debrief-card-work-on-this">
          {growth.map(({item, index}) => {
            const scenario = practiceFor(item.scenario_id);
            return (
              <ReadableItem
                key={`${item.turn_index}-${index}`}
                section={`work_on_this[${index}]`}>
                <Text style={s.lead}>{item.lead}</Text>
                <Quote text={item.quote} />
                <Text style={s.bodyText}>{item.why}</Text>
                <Text style={s.trySaying} testID="debrief-try-saying">
                  <Text style={s.trySayingLabel}>
                    {t('postSim.debriefCards.trySaying')}
                  </Text>{' '}
                  {item.try_saying}
                </Text>
                {scenario && <PractiseButton scenario={scenario} />}
                {flagControl(`work_on_this[${index}]`, item.lead)}
              </ReadableItem>
            );
          })}
          <View
            ref={readEndRef}
            onLayout={onReadEndLayout}
            testID="debrief-read-end"
          />
        </Card>
      )}

      {practise && (
        <Card
          title={t('postSim.debriefCards.practiseNext')}
          readSection="practise_next"
          testID="debrief-card-practise-next">
          <Text style={s.lead}>{practise.skill}</Text>
          <Text style={s.bodyText}>{practise.reason}</Text>
          {practiseNextScenario && (
            <PractiseButton scenario={practiseNextScenario} primary />
          )}
          {flagControl('practise_next', t('postSim.debriefCards.practiseNext'))}
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
        readSection="reflective_question"
        testID="debrief-card-reflective-question">
        <Text style={s.bodyText}>{cards.reflective_question}</Text>
        <ListenButton
          section="reflective_question"
          cardLabel={t('postSim.debriefCards.reflectiveQuestion')}
        />
        {replyThread}
      </Card>

      {removed.size > 0 && (
        <Text style={s.smallText} testID="debrief-removed-note">
          {t('postSim.debriefCards.corrections.removed')}
        </Text>
      )}
      <Helpful sessionId={sessionId} helpful={view.feedback?.helpful ?? null} />
    </View>
  );
};

/**
 * When the learner stepped out of the role in distress, care comes before
 * coaching: an acknowledgement and the support lines first, and the debrief
 * collapsed until the learner chooses to open it — mirrors ally-web.
 */
const DistressFirst: React.FC<{
  view: LearnerDebriefView;
  children: React.ReactNode;
}> = ({view, children}) => {
  const {t} = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <View style={s.stack}>
      <View style={s.distress} testID="debrief-distress">
        <Text style={s.cardTitle} accessibilityRole="header">
          {t('postSim.debriefCards.distress.title')}
        </Text>
        <Text style={s.bodyText}>
          {t('postSim.debriefCards.distress.body')}
        </Text>
        {!!view.supportLines?.length && (
          <>
            <Text style={s.bodyText}>
              {t('postSim.debriefCards.distress.supportLead')}
            </Text>
            <SupportLines lines={view.supportLines} />
          </>
        )}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        style={s.whenReady}
        testID="debrief-when-ready"
        onPress={() => setOpen(o => !o)}>
        <Text style={s.lead}>
          {t('postSim.debriefCards.distress.whenReady')}
        </Text>
        <Text style={s.lead} importantForAccessibility="no">
          {open ? '▴' : '▾'}
        </Text>
      </TouchableOpacity>
      {/* Not merely hidden: collapsed cards aren't laid out, so their end
          can't count as read. */}
      {open && children}
    </View>
  );
};

/**
 * The Debrief agent's debrief as cards, in the plan's order. No score and no
 * red: amber marks what needs attention, and every status carries text.
 * Mounted only when the learner's organisation is switched on.
 */
export const DebriefCards: React.FC<{
  view: LearnerDebriefView;
  sessionId: string;
  /** Ask Ally's thread and composer, under the reflective question. */
  replyThread?: React.ReactNode;
  /** The read-only Logs view: never marks the debrief opened. */
  readOnly?: boolean;
}> = ({view, sessionId, replyThread, readOnly = false}) => {
  const {t} = useTranslate();
  const openedSent = useRef(false);
  const readAloud = useDebriefReadAloud(sessionId);
  const ready = view.state === 'ready' && !!view.cards;
  const readToTheEnd = useReadToTheEnd(sessionId, ready);
  const latestStep = view.steps?.length
    ? view.steps[view.steps.length - 1]
    : undefined;
  // What the agent is doing now, worded in the learner's language; else its
  // last free-text step; else the default.
  const progressLine = (): string => {
    const p: DebriefProgress | null | undefined = view.progress;
    if (!p) {
      return latestStep || t('postSim.debriefCards.working.defaultStep');
    }
    if (p.key === 'guidance' && p.topic) {
      return t('postSim.debriefCards.working.steps.guidanceTopic', {
        topic: p.topic,
      });
    }
    if (p.key === 'revising') {
      return t('postSim.debriefCards.working.steps.revising', {
        round: p.round,
      });
    }
    return t(`postSim.debriefCards.working.steps.${p.key}`);
  };

  // Screen readers hear when a debrief the learner was waiting on lands —
  // only on the change, not when the screen opens on one already ready.
  const previousState = useRef(view.state);
  useEffect(() => {
    const was = previousState.current;
    previousState.current = view.state;
    if (ready && (was === 'working' || was === 'on_its_way')) {
      AccessibilityInfo.announceForAccessibility(
        t('postSim.debriefCards.ready.announce'),
      );
    }
    // `t` changes identity every render; only the state change matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.state, ready]);

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
          <Text style={s.bodyText} testID="debrief-working-step">
            {progressLine()}
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
    const cards = (
      <ReadyCards
        cards={view.cards}
        view={view}
        sessionId={sessionId}
        replyThread={replyThread}
        readEndRef={readToTheEnd.endRef}
        onReadEndLayout={readToTheEnd.measureEnd}
        readOnly={readOnly}
        openedSent={openedSent}
      />
    );
    content = view.distress ? (
      <DistressFirst view={view}>{cards}</DistressFirst>
    ) : (
      cards
    );
  }

  return (
    <ReadAloudContext.Provider value={ready ? readAloud : null}>
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
          {ready && <ListenAllBar sections={readableSections(view)} />}
          <View style={styles.contentContainer}>
            <View style={styles.content}>
              <ScrollView
                contentContainerStyle={s.scroll}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                onContentSizeChange={readToTheEnd.measureEnd}
                {...readToTheEnd.scrollProps}
                testID="debrief-cards">
                <View ref={readToTheEnd.contentRef} style={s.stack}>
                  <ReadAloudStatusLine />
                  {content}
                </View>
              </ScrollView>
            </View>
          </View>
        </LinearGradient>
        <ReadAloudPlayer />
      </View>
    </ReadAloudContext.Provider>
  );
};
