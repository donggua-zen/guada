import os
from pathlib import Path
from tinydb import TinyDB, Query
import ulid


class _CharacterService:
    def __init__(self):
        current_script_path = os.path.abspath(__file__)

        # 获取当前脚本所在的目录
        current_directory = os.path.dirname(current_script_path)

        self.db = TinyDB(current_directory + "/data/ai_characters.json")

    def get_all_characters(self):
        return self.db.all()

    def add_new_character(self, data):
        if "id" not in data:
            data["id"] = str(ulid.new())
        self.db.insert(data)
        return data

    def update_character(self, id, new_data):
        self.db.update(new_data, Query().id == id)

    def delete_character(self, id):
        self.db.remove(Query().id == id)

    def get_character_by_id(self, id):
        query = Query()
        result = self.db.search(query.id == id)
        return result[0] if len(result) > 0 else None


_character_service = _CharacterService()


def get_character_service() -> _CharacterService:
    return _character_service
