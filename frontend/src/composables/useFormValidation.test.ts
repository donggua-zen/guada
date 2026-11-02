
import { describe, expect, it } from 'vitest'
import { useFormValidation } from '../composables/useFormValidation'

describe('useFormValidation', () => {
  it('values getter 取值校验（required/正则）', async () => {
    const form = { username: '' }
    const { errors, validate } = useFormValidation({
      username: [{ validator: (v) => {
        const value = String(v ?? '')
        if (!value) return 'required-msg'
        return /^[a-z]{3}$/.test(value) ? null : 'format-msg'
      } }],
    }, () => form)

    const ok1 = await validate()
    expect(ok1).toBe(false)
    expect(errors.username).toBe('required-msg')

    form.username = 'toolong!'
    await validate()
    expect(errors.username).toBe('format-msg')

    form.username = 'abc'
    expect(await validate()).toBe(true)
    expect(errors.username).toBeUndefined()
  })

  it('async validator', async () => {
    const form = { name: 'taken' }
    const { errors, validate } = useFormValidation({
      name: [{ validator: async (v) => (v === 'taken' ? '已占用' : null) }],
    }, () => form)
    expect(await validate()).toBe(false)
    expect(errors.name).toBe('已占用')
  })

  it('clearValidate 清指定字段', async () => {
    const form = { a: '', b: '' }
    const { errors, validate, clearValidate } = useFormValidation({
      a: [{ validator: () => 'err-a' }],
      b: [{ validator: () => 'err-b' }],
    }, () => form)
    await validate()
    clearValidate(['a'])
    expect(errors.a).toBeUndefined()
    expect(errors.b).toBe('err-b')
  })
})
