"""Auth placeholder. Intern 4 (RBAC) replaces `current_user` with real JWT/PIN auth."""
from dataclasses import dataclass

from fastapi import Header


@dataclass
class User:
    id: str
    role: str


def current_user(x_user_id: str = Header("anonymous"), x_user_role: str = Header("waiter")) -> User:
    return User(id=x_user_id, role=x_user_role.lower())
