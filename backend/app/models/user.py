# models.py
import ulid
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager
from app.models.database import ModelBase, db

bcrypt = Bcrypt()
jwt = JWTManager()


class User(ModelBase):
    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    role = db.Column(db.String(20), nullable=True)
    avatar_url = db.Column(db.String(255), nullable=True)
    parent_id = db.Column(db.String(26), nullable=True, index=True)
    nickname = db.Column(db.String(80), nullable=True)
    phone = db.Column(db.String(20), index=True, nullable=True)
    email = db.Column(db.String(120), index=True, nullable=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def to_dict(self, exclude=None, include=None, flush=False):
        if exclude is None:
            exclude = []
        exclude = ["password_hash", *exclude]
        return super().to_dict(exclude, include, flush)
