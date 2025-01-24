import { DataTypes } from 'sequelize';
import { AppDataSource } from '../config';

export const AudioMaster = AppDataSource.define(
  'audio_stage',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    identifier: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description_hash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    audio_path: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    updated_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'audio_master',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
