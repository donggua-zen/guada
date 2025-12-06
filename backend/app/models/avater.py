import ulid
from app import db


class Avatar:
    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    filename = db.Column(db.String(255))
    file_size = db.Column(db.Integer)
    width = db.Column(db.Integer)
    height = db.Column(db.Integer)
    is_deleted = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(db.DateTime, default=db.func.now(), onupdate=db.func.now())
