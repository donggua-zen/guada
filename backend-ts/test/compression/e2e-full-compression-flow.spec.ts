/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { CompressionEngine, SummaryMode } from '../../src/modules/chat/compression-engine';
import { LLMService } from '../../src/modules/llm-core/llm.service';
import { TokenizerService } from '../../src/common/utils/tokenizer.service';
import { SessionContextStateRepository } from '../../src/common/database/session-context-state.repository';
import { MessageRecord } from '../../src/common/types/message.types';
import * as fs from 'fs';
import * as path from 'path';

describe('E2E Full Compression Flow: From First to Last Compression', () => {
  let engine: CompressionEngine;
  let tokenizerService: TokenizerService;
  let mockLLMService: any;
  let mockRepo: any;
  let testData: any;

  beforeAll(async () => {
    // Load full test data
    const testDataPath = path.join(__dirname, '..', 'fixtures', 'compression', 'e2e-full-compression-flow.json');
    testData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));

    // Use real TokenizerService (not mocked)
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        // Return default configuration
        const defaults: any = {
          TOKEN_CACHE_MAX_ENTRIES: 1000,
          TOKEN_CACHE_MAX_MEMORY_MB: 100,
          TOKEN_CACHE_TTL_MS: 3600000,
          TOKEN_CACHE_CLEANUP_INTERVAL_MS: 60000,
        };
        return defaults[key];
      }),
    };
    
    const realTokenizerService = new TokenizerService(
      new (require('../../src/common/utils/token-cache.service').TokenCacheService)(mockConfigService)
    );

    // Mock LLMService
    mockLLMService = {
      completions: jest.fn().mockResolvedValue({
        content: 'Mock summary',
        toolCalls: [],
      }),
    };

    // Mock Repository - Key: Maintain a state machine to simulate real checkpoint evolution
    const checkpoints = new Map<string, any>();
    
    mockRepo = {
      findBySessionId: jest.fn().mockImplementation(async (sessionId: string) => {
        return checkpoints.get(sessionId) || null;
      }),
      upsert: jest.fn().mockImplementation(async (sessionId: string, data: any) => {
        checkpoints.set(sessionId, data);
      }),
      create: jest.fn().mockImplementation(async (sessionId: string, data: any) => {
        checkpoints.set(sessionId, data);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompressionEngine,
        {
          provide: LLMService,
          useValue: mockLLMService,
        },
        {
          provide: TokenizerService,
          useValue: realTokenizerService,
        },
        {
          provide: SessionContextStateRepository,
          useValue: mockRepo,
        },
      ],
    }).compile();

    engine = module.get<CompressionEngine>(CompressionEngine);
    tokenizerService = module.get<TokenizerService>(TokenizerService);
  });

  it('should simulate complete compression flow from scratch, message by message', async () => {
    const sessionId = testData.sessionId;
    const allMessages = testData.messages;
    const checkpoints = testData.checkpoints;

    console.log('\n=== Starting Full Compression Flow Simulation ===\n');

    // Convert grouped messages to MessageRecord format (flatten)
    const allMessageRecords: MessageRecord[] = [];
    allMessages.forEach((msgGroup: any) => {
      msgGroup.contents.forEach((content: any) => {
        allMessageRecords.push({
          messageId: msgGroup.messageId,
          role: content.contentRole,
          content: content.content,
          contentId: content.contentId,
        });
      });
    });

    console.log(`Total MessageRecords: ${allMessageRecords.length}\n`);

    // Simulate adding messages one by one and triggering compression
    let currentMessages: MessageRecord[] = [];
    let compressionCount = 0;
    const compressionResults: any[] = [];

    // Add messages group by group (simulate real conversation turns)
    for (let msgIndex = 0; msgIndex < allMessages.length; msgIndex++) {
      const msgGroup = allMessages[msgIndex];
      
      // Add all contents of current message
      msgGroup.contents.forEach((content: any) => {
        currentMessages.push({
          messageId: msgGroup.messageId,
          role: content.contentRole,
          content: content.content,
          contentId: content.contentId,
        });
      });

      // Use compression engine's shouldCompress method to check if compression is needed
      const compressionConfig = {
        contextWindow: 128000,
        triggerRatio: 0.8,
        targetRatio: 0.5,
        chatModelName: 'deepseek-v4-flash',
        summaryMode: SummaryMode.DISABLED, // Disable LLM summary generation to avoid real LLM calls
      };

      const shouldCompress = await engine.shouldCompress(currentMessages, compressionConfig);

      if (shouldCompress) {
        const estimatedTokens = await tokenizerService.countTokens('deepseek-v4-flash', currentMessages);

        try {
          const result = await engine.execute(sessionId, currentMessages, compressionConfig);
          
          compressionCount++;
          
          // Assertion 1: Verify token count accuracy - must match exactly
          const actualTokenCount = await tokenizerService.countTokens('deepseek-v4-flash', result.messages);
          expect(result.tokenCount).toBe(actualTokenCount);
          
          // Update current messages to compressed result
          currentMessages = result.messages;
          
          // Record compression result
          compressionResults.push({
            compressionNumber: compressionCount,
            strategy: result.strategy,
            messageCount: result.messages.length,
            tokenCount: result.tokenCount,
          });

          // Assertion 2: Verify no large contents outside protected range
          // Protection rule: last 3 tool messages are protected
          const PROTECTED_COUNT = 3;
          let protectedToolCount = 0;
          let unprotectedLargeContents = 0;
          
          // Traverse from end to start, counting protected tool messages
          for (let i = result.messages.length - 1; i >= 0; i--) {
            const msg = result.messages[i];
            if (msg.role === 'tool') {
              if (protectedToolCount < PROTECTED_COUNT) {
                protectedToolCount++;
                continue; // This is in protected range
              }
            }
            
            // Check if this message has large content and is outside protected range
            if (typeof msg.content === 'string' && msg.content.length > 2048) {
              unprotectedLargeContents++;
            }
          }
          
          expect(unprotectedLargeContents).toBe(0);
        } catch (error: any) {
          console.error(`Compression #${compressionCount + 1} failed:`, error.message);
          throw error; // Re-throw to fail the test
        }
      } else {
        // No compression needed
      }
    }

    // Final assertions
    
    // Assertion 3: At least one compression should have been triggered
    expect(compressionCount).toBeGreaterThan(0);
    
    // Assertion 4: No large contents outside protected range in final result
    const PROTECTED_COUNT = 3;
    let protectedToolCount = 0;
    let finalUnprotectedLargeContents = 0;
    
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      const msg = currentMessages[i];
      if (msg.role === 'tool') {
        if (protectedToolCount < PROTECTED_COUNT) {
          protectedToolCount++;
          continue;
        }
      }
      
      if (typeof msg.content === 'string' && msg.content.length > 2048) {
        finalUnprotectedLargeContents++;
      }
    }
    
    expect(finalUnprotectedLargeContents).toBe(0);
    
    // Assertion 5: Compression count should be reasonable (within expected range)
    // Note: May differ from database records due to missing systemPrompt or manual triggers
    expect(compressionCount).toBeGreaterThanOrEqual(15); // At least 15 compressions
    expect(compressionCount).toBeLessThanOrEqual(30); // At most 30 compressions
  });
});
