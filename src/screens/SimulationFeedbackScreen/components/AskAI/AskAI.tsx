import React, {useState} from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import LinearGradient from 'react-native-linear-gradient';

import {RankBadgeIcon, UpArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {styles} from './styles';

// Mock data
const MOCK_QUESTION = "How did i handle the client's resistance?";
const MOCK_RESPONSE =
  'You responded to resistance with validation and gentle problem-solving, which reduced defensiveness (e.g., validated feelings at and offered start small steps at). You sometimes moved quickly to solutions instead of lingering on emotion—examples: offering noise-reduction strategies at and mindfulness at right after the client said tension persisted ([3:10]). Next time, hold the emotional space longer (reflect the heavy feeling at, use silence or brief paraphrase at) before proposing strategies so the client feels fully heard.';

export const AskAI: React.FC = () => {
  const {t} = useTranslate();
  const [question, setQuestion] = useState('');

  const handleSend = () => {
    if (question.trim()) {
      // TODO: Implement send functionality
      setQuestion('');
    }
  };

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
        <View style={styles.header}>
          <Text style={styles.headerText}>
            {t('SimulationFeedback.askAIHeader')}
          </Text>
        </View>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}>
          <View style={styles.contentContainer}>
            <View style={styles.content}>
              {/* Question Bubble */}
              <View style={styles.questionBubble}>
                <Text style={styles.questionText}>{MOCK_QUESTION}</Text>
              </View>

              {/* AI Response */}
              <View style={styles.responseContainer}>
                <View style={styles.rankBadgeContainer}>
                  <LinearGradient
                    colors={[colors.ds.blue[50], colors.white]}
                    start={{x: 0, y: 0}}
                    end={{x: 0, y: 1}}
                    style={styles.rankBadgeGradient}>
                    <RankBadgeIcon width={9} height={9} />
                  </LinearGradient>
                </View>
                <View style={styles.responseTextContainer}>
                  <Text style={styles.responseText}>{MOCK_RESPONSE}</Text>
                </View>
              </View>

              {/* Input Field */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder={t('SimulationFeedback.askAIPlaceholder')}
                  placeholderTextColor={colors.ds.typography.lowEmphasis}
                  value={question}
                  onChangeText={setQuestion}
                  multiline={false}
                />
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={handleSend}
                  activeOpacity={0.7}>
                  <UpArrowIcon width={14} height={14} color={colors.white} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </LinearGradient>
    </View>
  );
};
