import { expect } from "chai";
import { v4 as uuid } from "uuid";
import * as path from "path";
import { Umzug, SequelizeStorage } from "umzug";

import {
  sequelize,
  Sequelize,
  modelNames,
  User,
  Session,
  Recipe,
  Label,
  Message,
} from "./models/index.js";

const umzug = new Umzug({
  migrations: {
    glob: path.join(__dirname, "migrations/*.js"),
    resolve: ({ name, path }) => {
      return {
        name,
        up: async () =>
          (await import(path)).up(sequelize.getQueryInterface(), Sequelize),
        down: async () =>
          (await import(path)).down(sequelize.getQueryInterface(), Sequelize),
      };
    },
  },
  storage: new SequelizeStorage({ sequelize }),
  logger: undefined,
});

let migrate = async (down) => {
  if (down) {
    await umzug.down();
  } else {
    await umzug.up();
  }
};

export const syncDB = async () => {
  await Promise.all(
    modelNames.map(async (modelName) => {
      await (
        await import("./models")
      )[modelName].destroy({
        truncate: true,
        cascade: true,
        hooks: false,
      });
    })
  );
};

export const setup = async () => {
  await migrate();
  const mainExecutable = await import("./app");

  return mainExecutable.app;
};

export const cleanup = async () => {
  await migrate(true);
};

export function randomString(len) {
  let chars = "abcdefghijklmnopqrstuvwxyz";

  let str = [];
  for (let i = 0; i < len; i++)
    str.push(chars.charAt(Math.floor(Math.random() * (chars.length - 1))));

  return str.join("");
}

export function randomEmail() {
  return `${randomString(20)}@gmail.com`;
}

export const createUser = () => {
  return User.create({
    name: `${randomString(10)} ${randomString(10)}`,
    email: randomEmail(),
    passwordHash:
      "SaVNC9ubXV8BHykB2wAD0mhxPwh/W7O7Rz+qRy/PeV+GeeakLzkv2TSghPQvLTe07b7TqxdsRUt39lC3RaaWmhORkVS9UbtEIh9dzvcbj9VzHA0ex0k97nv0lE56Jh6D6M5Laxe2BrkpiUibP3yCDCk75vCHtLGTZVjqtabTGheIs/QwiD72C7H+bK4QSL2RYSOEbB0wysNAC5nF8r1m36FB/DS5wEixOWiQH470H1s9yHODAALNag9Lom+It4P3cMSSa83mxPNvFOniEpuDDcI5W/Oxef/XiA3EhMLL8n4+CSV1Z891g65U7j7RIKSCjK1LbCvQ5JuS/jZCErNBW9472TXdGKGeYY6RTDgSBzqISyxlMCSRBsNjToWHJyPEyEbt0BTSjTkliB+0wSQpdzUiDDiJNrLVimAriH/AcU/eFvpU5YyyY1coY8Kc80LxKxP/p881Q0DABCmaRcDH+/1iEz3SoWNvSsw/Xq8u9LcgKCjccDoD8tKBDkMijS7TBPu9zJd2nUqblPO+KTGz7hVqh/u0VQ+xEdvRQuKSc+4OnUtQRVCAFQGB99hfXfQvffeGosNy3BABEuZkobaUgs8m8RTaRFGqy8qk6BYw1bk5I5KjjmA8GNOtNHlKQ+1EZO83pIKbG61Jfm93FJ6CsWji9fXsxaBsv+JNBhRgmUw=",
    passwordSalt:
      "dM4YXu5N5XY4c0LXnf30vtshh7dgsBYZ/5pZockgcJofPkWhMOplVAoWKhyqODZhO3mSUBqMqo3kXC2+7fOMt1NFB0Q1iRcJ4zaqAqdTenyjXu7rJ8WpgR1qnTcnpP8g/frQ+sk8Kcv49OC84R3v+FD8RrGm0rz8dDt7m7c/+Rw=",
    passwordVersion: 2,
  });
};

export const createSession = (userId) => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  return Session.create({
    userId,
    token: randomString(40),
    type: "user",
    expires: tomorrow,
  });
};

export const createRecipe = (userId, folder, fromUserId) => {
  return Recipe.create({
    userId,
    fromUserId: fromUserId,
    title: randomString(20),
    description: randomString(20),
    yield: randomString(20),
    activeTime: randomString(20),
    totalTime: randomString(20),
    source: randomString(20),
    url: randomString(20),
    notes: randomString(20),
    ingredients: randomString(20),
    instructions: randomString(20),
    folder: folder || "main",
  });
};

export const createLabel = (userId) => {
  return Label.findOrCreate({
    where: {
      userId: userId,
      title: randomString(20),
    },
  }).then(function (labels) {
    return labels[0];
  });
};

export const associateLabel = (labelId, recipeId) => {
  return Label.findByPk(labelId).then((label) => {
    return label.addRecipe(recipeId);
  });
};

export const createMessage = (
  fromUserId,
  toUserId,
  recipeId,
  originalRecipeId
) => {
  return Message.create({
    fromUserId,
    toUserId,
    recipeId,
    originalRecipeId,
    body: recipeId ? "" : randomString(40),
  });
};

// Validates that fields match but we are not sending any additional private data
export const secureUserMatch = (userHash, user) => {
  expect(userHash.id).to.equal(user.id);
  expect(userHash.name).to.equal(user.name);
  expect(userHash.email).to.equal(user.email);

  expect(Object.keys(userHash).length).to.equal(3);
};

// Validates that fields match but we are not sending any additional private data
export const secureRecipeMatch = (recipeHash, recipe) => {
  expect(recipeHash.id).to.equal(recipe.id);
  expect(recipeHash.title).to.equal(recipe.title);

  let allowedFieldCount = 2;
  if (recipeHash.images) allowedFieldCount++;

  expect(Object.keys(recipeHash).length).to.equal(allowedFieldCount);
};

export const randomUuid = () => {
  return uuid();
};
