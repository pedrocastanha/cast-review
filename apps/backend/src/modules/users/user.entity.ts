import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity } from 'typeorm';

@Entity({
  name: 'users',
  orderBy: {
    createdAt: 'ASC',
  },
})
export class Users extends DefaultEntity<Users> {
    @Column
}
