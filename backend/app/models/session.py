import ulid
from .database import ModelBase, db


class Session(ModelBase):
    __tablename__ = "session"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    title = db.Column(db.String, index=True)
    user_id = db.Column(db.String, index=True)
    # character_id = Column(String, index=True)
    # memory_type = Column(String, nullable=True)
    # model = Column(String, nullable=True)
    avatar_url = db.Column(db.String, nullable=True)
    description = db.Column(db.String, nullable=True)
    # system_prompt = Column(Text, nullable=True)
    settings = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
