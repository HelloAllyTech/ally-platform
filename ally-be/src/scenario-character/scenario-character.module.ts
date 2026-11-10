import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { ContextLibraryModule } from '../context-library/context-library.module';
import { ScenarioCharacter } from './entity/scenario-character.entity';
import { CharacterInterviewSession } from './entity/character-interview-session.entity';
import { CharacterInterviewMessage } from './entity/character-interview-message.entity';
import { ScenarioCharacterController } from './controller/scenario-character.controller';
import { CharacterInterviewController } from './controller/character-interview.controller';
import { ScenarioCharacterService } from './service/scenario-character.service';
import { CharacterLibraryAccessService } from './service/character-library-access.service';
import { CharacterInterviewSessionService } from './service/character-interview-session.service';
import { CharacterInterviewToolsService } from './service/character-interview-tools.service';
import { CharacterInterviewOrchestratorService } from './service/character-interview-orchestrator.service';
import { ScenarioCharacterRepository } from './repository/scenario-character.repository';
import { CharacterInterviewSessionRepository } from './repository/character-interview-session.repository';
import { CharacterInterviewMessageRepository } from './repository/character-interview-message.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScenarioCharacter,
      ScenarioCharacterRepository,
      CharacterInterviewSession,
      CharacterInterviewMessage,
    ]),
    PromptModule,
    LlmUsageModule,
    LlmAgentModule,
    // For search_corpus: the interview agent grounds its questions and drafts on the
    // Character Insights collection through ContextRetrievalService (use case
    // `character_interview`), never by reaching into the Context Library's tables itself.
    ContextLibraryModule,
  ],
  controllers: [ScenarioCharacterController, CharacterInterviewController],
  providers: [
    ScenarioCharacterService,
    CharacterLibraryAccessService,
    ScenarioCharacterRepository,
    CharacterInterviewSessionService,
    CharacterInterviewToolsService,
    CharacterInterviewOrchestratorService,
    CharacterInterviewSessionRepository,
    CharacterInterviewMessageRepository,
  ],
  // CharacterLibraryAccessService: Course Copilot's catalogue search rechecks every character it
  // shows against the asker's slice of the library.
  exports: [ScenarioCharacterService, CharacterLibraryAccessService],
})
export class ScenarioCharacterModule {}
