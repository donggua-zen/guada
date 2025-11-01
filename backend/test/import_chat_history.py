from message_service import get_message_service


SESSION_ID = "test"
message_service = get_message_service()
message_service.delete_messages_by_session_id(SESSION_ID)