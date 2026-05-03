import { Inject, Injectable } from "@nestjs/common";
import { ConversationContext } from "./conversation-context";
import { IConversationContext, IMessageStore, ICompressionStrategy } from "./interfaces";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ModelRepository } from "../../common/database/model.repository";
import { SK_MOD_COMPRESS_MODEL, SG_MODELS } from "../../constants/settings.constants";
import { TokenizerService } from "../../common/utils/tokenizer.service";

export const MESSAGE_STORE_TOKEN = "IMessageStore";
export const COMPRESSION_STRATEGY_TOKEN = "ICompressionStrategy";

@Injectable()
export class ConversationContextFactory {
  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private messageStore: IMessageStore,
    @Inject(COMPRESSION_STRATEGY_TOKEN) private compressionStrategy: ICompressionStrategy,
    private settingsStorage: SettingsStorage,
    private modelRepository: ModelRepository,
    private tokenizerService: TokenizerService,
  ) {}

  async create(sessionId: string, userId: string): Promise<IConversationContext> {
    return new ConversationContext(
      sessionId,
      this.messageStore,
      this.compressionStrategy,
      this.settingsStorage,
      this.modelRepository,
      this.tokenizerService,
    );
  }
}
