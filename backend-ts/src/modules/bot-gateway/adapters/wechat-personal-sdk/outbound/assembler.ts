import type { IlinkJsonTransport } from "../transport/ilink-json-transport";
import { nextOutboundClientMarker } from "../internal/random-tags";
import { AuthorKind, ItemKind, OutboxPhase } from "../protocol/wire-models";
import type { OutboundWireEnvelope, WireCompositeItem } from "../protocol/wire-models";
import type { StagedCipherPayload } from "../cdn/payload-pipeline";

async function emitIsolatedFacet(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    facet: WireCompositeItem,
): Promise<string> {
    const clientId = nextOutboundClientMarker();
    const envelope: OutboundWireEnvelope = {
        msg: {
            from_user_id: "",
            to_user_id: peerKey,
            client_id: clientId,
            message_type: AuthorKind.Bot,
            message_state: OutboxPhase.Settled,
            item_list: [facet],
            context_token: contextToken,
        },
    };
    await transport.dispatchOutboundEnvelope(envelope);
    return clientId;
}

async function emitFacetChain(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    facets: WireCompositeItem[],
): Promise<string> {
    let last = "";
    for (const facet of facets) {
        last = await emitIsolatedFacet(transport, peerKey, contextToken, facet);
    }
    return last;
}

export function packLiteralReply(peerKey: string, contextToken: string, text: string): OutboundWireEnvelope {
    return {
        msg: {
            from_user_id: "",
            to_user_id: peerKey,
            client_id: nextOutboundClientMarker(),
            message_type: AuthorKind.Bot,
            message_state: OutboxPhase.Settled,
            item_list: text ? [{ type: ItemKind.Text, text_item: { text } }] : undefined,
            context_token: contextToken,
        },
    };
}

export async function postLiteralReply(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    text: string,
): Promise<{ messageId: string }> {
    const envelope = packLiteralReply(peerKey, contextToken, text);
    await transport.dispatchOutboundEnvelope(envelope);
    return { messageId: envelope.msg?.client_id ?? "" };
}

export async function postPhotoBundle(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    staged: StagedCipherPayload,
    caption?: string,
): Promise<string> {
    const chain: WireCompositeItem[] = [];
    if (caption) {
        chain.push({ type: ItemKind.Text, text_item: { text: caption } });
    }
    chain.push({
        type: ItemKind.Image,
        image_item: {
            media: {
                encrypt_query_param: staged.remoteHandle,
                aes_key: Buffer.from(staged.aesKeyHex, "hex").toString("base64"),
                encrypt_type: 1,
            },
            mid_size: staged.cipherBudget,
        },
    });
    return emitFacetChain(transport, peerKey, contextToken, chain);
}

export async function postVideoBundle(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    staged: StagedCipherPayload,
    caption?: string,
): Promise<string> {
    const chain: WireCompositeItem[] = [];
    if (caption) {
        chain.push({ type: ItemKind.Text, text_item: { text: caption } });
    }
    chain.push({
        type: ItemKind.Video,
        video_item: {
            media: {
                encrypt_query_param: staged.remoteHandle,
                aes_key: Buffer.from(staged.aesKeyHex, "hex").toString("base64"),
                encrypt_type: 1,
            },
            video_size: staged.cipherBudget,
        },
    });
    return emitFacetChain(transport, peerKey, contextToken, chain);
}

export async function postFileBundle(
    transport: IlinkJsonTransport,
    peerKey: string,
    contextToken: string,
    staged: StagedCipherPayload,
    caption?: string,
): Promise<string> {
    const chain: WireCompositeItem[] = [];
    if (caption) {
        chain.push({ type: ItemKind.Text, text_item: { text: caption } });
    }
    chain.push({
        type: ItemKind.File,
        file_item: {
            media: {
                encrypt_query_param: staged.remoteHandle,
                aes_key: Buffer.from(staged.aesKeyHex, "hex").toString("base64"),
                encrypt_type: 1,
            },
            file_name: staged.originalName,
            len: String(staged.plainBytes),
        },
    });
    return emitFacetChain(transport, peerKey, contextToken, chain);
}
